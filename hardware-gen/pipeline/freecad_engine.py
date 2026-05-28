"""
FreeCAD CAD engine strategy.

This engine does NOT import FreeCAD directly.  Instead it locates the
``freecadcmd`` (or ``FreeCADCmd``) binary on the host and delegates each
stage to a standalone helper script inside ``freecad_scripts/``.  Those
helper scripts run inside FreeCAD's bundled Python interpreter, which has
access to the Part, TechDraw, and Fasteners workbench modules.

Why subprocess instead of direct import?
  - FreeCAD ships its own Python interpreter; mixing it with the venv that
    runs this CLI causes import conflicts on most Linux distros.
  - The subprocess boundary gives us a clean failure mode (non-zero exit
    with a readable stderr) and makes CI reproducible regardless of host
    Python version.
  - Future engines (build123d) run natively in the venv — the split keeps
    them independent.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .engine_base import CADEngine, register_engine
from .models import FastenerSpec

log = logging.getLogger(__name__)

# Directory that contains stage1_3d.py and stage2_2d.py
_SCRIPTS_DIR = Path(__file__).parent.parent / "freecad_scripts"

# ── FreeCAD binary discovery ───────────────────────────────────────────────────

# Names to search on PATH (package installs, conda, etc.)
_FREECADCMD_PATH_CANDIDATES: list[str] = [
    "freecadcmd",         # typical Linux package install
    "FreeCADCmd",         # alternative capitalisation
    "freecad-python3",    # some distros
    "/usr/bin/freecadcmd",
    "/usr/local/bin/freecadcmd",
    "/opt/freecad/bin/freecadcmd",
]

# Directories to glob for FreeCAD AppImages (user-space locations)
_APPIMAGE_SEARCH_DIRS: list[Path] = [
    Path.home(),
    Path.home() / "bin",
    Path.home() / ".local" / "bin",
    Path.home() / "Applications",
    Path("/opt"),
    Path("/opt/freecad"),
]

# Glob patterns matched inside each search dir (case-insensitive via both forms)
_APPIMAGE_GLOBS: list[str] = ["FreeCAD*.AppImage", "freecad*.AppImage"]


def _find_freecadcmd() -> list[str]:
    """
    Return a command prefix (path + any required flags) for freecadcmd.

    Search order:
      1. ``FREECADCMD`` environment variable — split on whitespace, first token
         must be an executable file.  Allows full override including flags,
         e.g. ``export FREECADCMD="/home/user/FreeCAD.AppImage --console"``.
      2. PATH search for each name in ``_FREECADCMD_PATH_CANDIDATES``.
      3. Glob search for AppImages in ``_APPIMAGE_SEARCH_DIRS``; the first
         match is returned with ``["--console"]`` appended.
      4. Raise ``RuntimeError`` with install guidance.
    """
    env_override = os.environ.get("FREECADCMD")
    if env_override:
        tokens = env_override.split()
        executable = tokens[0]
        if not os.path.isfile(executable) or not os.access(executable, os.X_OK):
            raise RuntimeError(
                f"FREECADCMD env var points to '{executable}' which is not executable."
            )
        log.debug("Using FREECADCMD from environment: %s", tokens)
        return tokens

    for candidate in _FREECADCMD_PATH_CANDIDATES:
        found = shutil.which(candidate)
        if found:
            log.debug("Found freecadcmd on PATH: %s", found)
            return [found]

    for search_dir in _APPIMAGE_SEARCH_DIRS:
        if not search_dir.is_dir():
            continue
        for pattern in _APPIMAGE_GLOBS:
            for match in sorted(search_dir.glob(pattern)):
                if os.access(match, os.X_OK):
                    log.debug("Found FreeCAD AppImage: %s", match)
                    return [str(match), "--console"]

    raise RuntimeError(
        "freecadcmd not found.\n\n"
        "For local development (no FreeCAD required):\n"
        "  uv run generate.py --dry-run\n\n"
        "For actual 3D/SVG generation, install FreeCAD and set FREECADCMD:\n"
        "  AppImage:  export FREECADCMD=\"$HOME/FreeCAD.AppImage --console\"\n"
        "  No FUSE:   export FREECADCMD=\"$HOME/FreeCAD.AppImage --appimage-extract-and-run --console\"\n"
        "  apt:       sudo apt install freecad  (Ubuntu 22.04 / Debian)\n"
        "  Conda:     conda install -c conda-forge freecad\n"
        "  See hardware-gen/README.md for full instructions."
    )


# ── Engine implementation ──────────────────────────────────────────────────────

@register_engine
class FreeCADEngine(CADEngine):
    """Two-stage pipeline backed by FreeCAD + Fasteners workbench."""

    name = "freecad"

    def __init__(self, build_dir: Path, output_dir: Path) -> None:
        super().__init__(build_dir, output_dir)
        self._cmd: list[str] = _find_freecadcmd()

    # ── Stage 1: 3D solid ─────────────────────────────────────────────────────

    def generate_3d(self, spec: FastenerSpec) -> Path:
        """
        Run ``freecad_scripts/stage1_3d.py`` inside freecadcmd to produce a
        STEP (or .FCStd) file in the build directory.

        Parameters are passed as a JSON string via the ``HW_GEN_PARAMS``
        environment variable so that freecadcmd's argument parser doesn't
        consume them.
        """
        out_path = self._3d_artifact_path(spec)
        params = {
            "standard":  spec.standard,
            "size":      spec.size,
            "length":    spec.length,
            "out_path":  str(out_path),
            "format":    spec.pipeline.export_3d,
        }
        log.info("[Stage 1] Generating 3D: %s → %s", spec.name, out_path.name)
        self._run_freecad_script(_SCRIPTS_DIR / "stage1_3d.py", params)
        if not out_path.exists():
            raise RuntimeError(
                f"Stage 1 completed but expected output not found: {out_path}"
            )
        log.info("[Stage 1] Done: %s", out_path)
        return out_path

    # ── Stage 2: 2D SVG views ─────────────────────────────────────────────────

    def generate_2d(self, spec: FastenerSpec, model_path: Path) -> list[Path]:
        """
        Run ``freecad_scripts/stage2_2d.py`` to project *model_path* into
        each requested view and write SVG files into the output directory.

        Returns the list of SVG paths that were created.
        """
        created: list[Path] = []
        for view in spec.pipeline.export_2d_views:
            svg_path = self._2d_artifact_path(spec, view)
            params = {
                "model_path": str(model_path),
                "view":       view,
                "out_path":   str(svg_path),
            }
            log.info(
                "[Stage 2] Projecting %s view: %s → %s",
                view,
                spec.name,
                svg_path.name,
            )
            self._run_freecad_script(_SCRIPTS_DIR / "stage2_2d.py", params)
            if not svg_path.exists():
                raise RuntimeError(
                    f"Stage 2 completed but expected SVG not found: {svg_path}"
                )
            log.info("[Stage 2] Done: %s", svg_path)
            created.append(svg_path)
        return created

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _run_freecad_script(self, script: Path, params: Mapping[str, Any]) -> None:
        """
        Execute *script* inside freecadcmd, passing *params* via the
        ``HW_GEN_PARAMS`` environment variable.

        Raises ``subprocess.CalledProcessError`` on non-zero exit so the
        caller sees a clear failure.
        """
        env = os.environ.copy()
        env["HW_GEN_PARAMS"] = json.dumps(params)

        cmd = self._cmd + [str(script)]
        log.debug("Running: %s", " ".join(cmd))

        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
        )

        # Always show FreeCAD's stdout/stderr at DEBUG level so ``-v`` exposes it.
        if result.stdout:
            for line in result.stdout.splitlines():
                log.debug("[freecad] %s", line)
        if result.stderr:
            for line in result.stderr.splitlines():
                log.debug("[freecad-err] %s", line)

        if result.returncode != 0:
            # Promote both stdout and stderr to ERROR — stage scripts log to stdout.
            log.error(
                "freecadcmd exited %d.\nstdout:\n%s\nstderr:\n%s",
                result.returncode,
                result.stdout,
                result.stderr,
            )
            raise subprocess.CalledProcessError(
                result.returncode, cmd, result.stdout, result.stderr
            )
