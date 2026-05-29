#!/usr/bin/env python3
"""
hardware-gen: headless hardware 3D/2D generation pipeline.

Usage:
    uv run generate.py                       # process all YAML files in ./config/
    uv run generate.py config/bolts_screws.yaml
    uv run generate.py --engine freecad --verbose config/nuts.yaml

The tool runs a two-stage pipeline per fastener:
  Stage 1 – generate a 3D solid (STEP or .FCStd) → ./build/
  Stage 2 – project 2D SVG views                 → ./output/
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any

import yaml  # PyYAML

from pipeline.build123d_engine import Build123dEngine  # noqa: F401
from pipeline.engine_base import CADEngine, get_engine

# Load both engine modules so their @register_engine decorators fire.
# The import order determines which engine is listed first in --help but has
# no other significance.
from pipeline.freecad_engine import FreeCADEngine  # noqa: F401
from pipeline.models import FastenerSpec, HardwareConfig
from pipeline.standards import (
    UnknownStandardError,
    resolve_standard,
    validate_standard,
)

# ── Paths ─────────────────────────────────────────────────────────────────────

_ROOT       = Path(__file__).parent
_CONFIG_DIR = _ROOT / "config"
_BUILD_DIR  = _ROOT / "build"
_OUTPUT_DIR = _ROOT / "output"


# ── CLI ───────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="generate.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "config_files",
        nargs="*",
        metavar="CONFIG",
        help=(
            "YAML config file(s) to process. "
            "If omitted, all *.yaml files in ./config/ are discovered automatically."
        ),
    )
    p.add_argument(
        "--engine",
        default="freecad",
        choices=["freecad", "build123d"],
        help="CAD engine backend to use (default: freecad).",
    )
    p.add_argument(
        "--build-dir",
        default=str(_BUILD_DIR),
        metavar="DIR",
        help="Directory for intermediate 3D artifacts (default: ./build/).",
    )
    p.add_argument(
        "--output-dir",
        default=str(_OUTPUT_DIR),
        metavar="DIR",
        help="Directory for final SVG outputs (default: ./output/).",
    )
    p.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable DEBUG-level logging (includes full freecadcmd output).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate configs but do not call the CAD engine.",
    )
    return p


# ── YAML loading ──────────────────────────────────────────────────────────────

def _load_config(path: Path) -> HardwareConfig:
    """Parse a YAML file and return a typed ``HardwareConfig``."""
    with path.open("r", encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f) or {}
    return HardwareConfig.from_dict(raw, source_file=str(path))


def _discover_configs(config_dir: Path) -> list[Path]:
    """Return all *.yaml / *.yml files in *config_dir*, sorted."""
    found = sorted(
        list(config_dir.glob("*.yaml")) + list(config_dir.glob("*.yml"))
    )
    if not found:
        raise FileNotFoundError(
            f"No YAML files found in config directory: {config_dir}\n"
            "Create a YAML file there or pass a file path explicitly."
        )
    return found


# ── Standards resolution ──────────────────────────────────────────────────────

def _resolve_spec_standards(spec: FastenerSpec) -> FastenerSpec:
    """
    Normalise *spec.standard* to its canonical workbench name and validate it.

    Raises :class:`UnknownStandardError` if the resolved name is not a FreeCAD
    Fasteners workbench standard. Only renders reach here, so catalog-only
    entries are never validated against the workbench.
    """
    spec.standard = resolve_standard(spec.standard)
    validate_standard(spec.standard)
    return spec


# ── Pipeline orchestration ────────────────────────────────────────────────────

def _run_pipeline(
    spec: FastenerSpec,
    engine: CADEngine | None,
    dry_run: bool,
    log: logging.Logger,
) -> bool:
    """
    Run Stage 1 + Stage 2 for a single fastener.

    Returns True on success, False on failure (so the caller can accumulate
    results across a batch and report a summary at the end).
    """
    log.info("── %s [%s %s] ──", spec.name, spec.standard, spec.size)

    if dry_run:
        log.info("  [dry-run] would generate views: %s", spec.views)
        return True

    assert engine is not None
    try:
        # Stage 1
        model_path = engine.generate_3d(spec)

        # Stage 2 — only if views are requested
        if spec.views:
            svg_paths = engine.generate_2d(spec, model_path)
            for p in svg_paths:
                log.info("  → %s", p)
        else:
            log.info("  No 2D views requested; skipping Stage 2.")

        return True

    except Exception as exc:  # noqa: BLE001
        log.error("FAILED %s: %s", spec.name, exc)
        return False


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    parser = _build_parser()
    args   = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("hw-gen")

    # ── Resolve config files ──────────────────────────────────────────────────

    if args.config_files:
        config_paths = [Path(p) for p in args.config_files]
        missing = [p for p in config_paths if not p.exists()]
        if missing:
            for m in missing:
                log.error("Config file not found: %s", m)
            return 1
    else:
        try:
            config_paths = _discover_configs(_CONFIG_DIR)
        except FileNotFoundError as exc:
            log.error("%s", exc)
            return 1

    log.info("Config files: %s", [str(p) for p in config_paths])

    # ── Initialise engine ─────────────────────────────────────────────────────
    # Skip engine init on dry-run so the YAML validation path works without
    # FreeCAD installed (useful in CI lint jobs and local authoring).

    engine: CADEngine | None = None
    if not args.dry_run:
        engine_cls = get_engine(args.engine)
        try:
            engine = engine_cls(
                build_dir=Path(args.build_dir),
                output_dir=Path(args.output_dir),
            )
            log.info("Engine: %s", engine.name)
        except RuntimeError as exc:
            log.error("Engine init failed: %s", exc)
            return 1

    # ── Process configs ───────────────────────────────────────────────────────

    total = passed = failed = 0

    for config_path in config_paths:
        log.info("=== Processing: %s ===", config_path)
        try:
            config = _load_config(config_path)
        except Exception as exc:  # noqa: BLE001
            log.error("Failed to load config '%s': %s", config_path, exc)
            failed += 1
            continue

        specs = config.fastener_specs()
        if not specs:
            log.warning("No renders defined in: %s", config_path)
            continue

        for spec in specs:
            total += 1
            try:
                spec = _resolve_spec_standards(spec)
            except UnknownStandardError as exc:
                log.error("── %s ── %s", spec.name, exc)
                failed += 1
                continue
            ok = _run_pipeline(spec, engine, dry_run=args.dry_run, log=log)
            if ok:
                passed += 1
            else:
                failed += 1

    # ── Summary ───────────────────────────────────────────────────────────────

    log.info("=" * 60)
    log.info("Done. Total: %d  Passed: %d  Failed: %d", total, passed, failed)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
