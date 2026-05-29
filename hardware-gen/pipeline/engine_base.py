"""
Strategy pattern base class for CAD engines.

Adding a new backend (e.g. build123d, CadQuery, OpenSCAD) means:
  1. Subclass ``CADEngine``.
  2. Implement ``generate_3d`` and ``generate_2d``.
  3. Register the class in the ``ENGINE_REGISTRY`` in this module.
  4. Pass ``--engine <name>`` on the CLI.

No other files need to change.
"""

from __future__ import annotations

import abc
import logging
from pathlib import Path

from .models import FastenerSpec

log = logging.getLogger(__name__)


class CADEngine(abc.ABC):
    """Abstract base for all CAD backend strategies."""

    # Human-readable name used in log output and the CLI --engine flag.
    name: str = "base"

    def __init__(self, build_dir: Path, output_dir: Path) -> None:
        self.build_dir = build_dir
        self.output_dir = output_dir
        build_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)

    # ── Stage 1 ───────────────────────────────────────────────────────────────

    @abc.abstractmethod
    def generate_3d(self, spec: FastenerSpec) -> Path:
        """
        Generate the 3D solid for *spec* and return the path to the artifact.

        The artifact is written into ``self.build_dir`` and may be a STEP
        file, a FreeCAD .FCStd file, or any format the engine supports.
        """

    # ── Stage 2 ───────────────────────────────────────────────────────────────

    @abc.abstractmethod
    def generate_2d(self, spec: FastenerSpec, model_path: Path) -> list[Path]:
        """
        Project *model_path* into the 2D views requested in *spec.views*.

        Returns the list of generated SVG file paths written into
        ``self.output_dir``.
        """

    # ── Shared helpers ────────────────────────────────────────────────────────

    def _3d_artifact_path(self, spec: FastenerSpec) -> Path:
        """Canonical build-dir path for the 3D artifact of *spec* (always STEP)."""
        return self.build_dir / f"{spec.name}.step"

    def _2d_artifact_path(self, spec: FastenerSpec, view: str) -> Path:
        """Canonical output-dir path for a single 2D view."""
        return self.output_dir / f"{spec.name}_{view}.svg"


# ── Registry ──────────────────────────────────────────────────────────────────
# Populated by each engine module at import time via ``register_engine``.

_REGISTRY: dict[str, type[CADEngine]] = {}


def register_engine(cls: type[CADEngine]) -> type[CADEngine]:
    """Decorator: register *cls* so the CLI can look it up by name."""
    _REGISTRY[cls.name] = cls
    log.debug("Registered CAD engine: %s", cls.name)
    return cls


def get_engine(name: str) -> type[CADEngine]:
    """Return the engine class for *name*, or raise ``KeyError``."""
    if name not in _REGISTRY:
        available = ", ".join(sorted(_REGISTRY)) or "(none loaded)"
        raise KeyError(
            f"Unknown engine '{name}'. Available engines: {available}"
        )
    return _REGISTRY[name]
