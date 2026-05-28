"""
build123d CAD engine strategy — stub for future implementation.

build123d (https://github.com/gumyr/build123d) is a Pythonic BREP modelling
library built on top of Open CASCADE Technology (OCCT), the same kernel used
by FreeCAD.  Unlike FreeCAD it installs cleanly into a standard Python venv
(``uv pip install build123d``), which makes it attractive for CI pipelines
that don't want to install the full FreeCAD desktop application.

To activate this engine, pass ``--engine build123d`` on the CLI.

Implementation checklist (for a future contributor):
  [ ] Install build123d: ``uv pip install build123d``
  [ ] Use the ``fastener`` sub-package (or cq-warehouse) to generate fastener
      geometry natively — no subprocess required.
  [ ] Implement ``generate_3d`` using ``Compound.export_step``.
  [ ] Implement ``generate_2d`` using ``ExportSVG`` from ``build123d.exporters``
      with configurable ``ProjectionDir`` per view.
  [ ] Remove this stub comment block once the implementation is complete.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .engine_base import CADEngine, register_engine
from .models import FastenerSpec

log = logging.getLogger(__name__)


@register_engine
class Build123dEngine(CADEngine):
    """build123d CAD engine — not yet implemented."""

    name = "build123d"

    def generate_3d(self, spec: FastenerSpec) -> Path:
        raise NotImplementedError(
            "build123d engine is not yet implemented. "
            "Use --engine freecad or contribute an implementation."
        )

    def generate_2d(self, spec: FastenerSpec, model_path: Path) -> list[Path]:
        raise NotImplementedError(
            "build123d engine is not yet implemented. "
            "Use --engine freecad or contribute an implementation."
        )
