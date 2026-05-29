"""
Stage 2 – 2D SVG projection.

This script is executed inside FreeCAD's bundled Python interpreter via:

    freecadcmd /path/to/stage2_2d.py

It reads a 3D model (STEP or .FCStd) produced by Stage 1, projects it into
the requested view, and writes an SVG file.

Expected ``HW_GEN_PARAMS`` JSON keys:
    model_path : str  — absolute path to the Stage 1 artifact (.step or .fcstd)
    view       : str  — one of "top", "side", "front", "iso"
    out_path   : str  — absolute path for the output SVG

View direction convention (right-hand, Z-up).
NB: TechDraw's ``Direction`` is the vector pointing FROM the object TOWARD the
viewer (the out-of-page normal), not the direction of gaze.  So a top view —
looking down at the +Z head face — uses direction (0, 0, 1), not (0, 0, -1).
    top   → viewer above   → direction (0,  0,  1),  up (0, 1, 0)
    front → viewer in front→ direction (0, -1,  0),  up (0, 0, 1)
    side  → viewer at right → direction (1,  0,  0),  up (0, 0, 1)
    iso   → isometric      → direction (1, -1,  1).normalize(), up (0, 0, 1)

Exit codes:
    0  — success
    1  — parameter error
    2  — FreeCAD / rendering error
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import sys

logging.basicConfig(
    level=logging.INFO,
    format="[stage2] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Parameter ingestion ───────────────────────────────────────────────────────

raw = os.environ.get("HW_GEN_PARAMS", "")
if not raw:
    log.error("HW_GEN_PARAMS environment variable is not set.")
    sys.exit(1)

try:
    params: dict = json.loads(raw)
except json.JSONDecodeError as exc:
    log.error("Failed to parse HW_GEN_PARAMS JSON: %s", exc)
    sys.exit(1)

model_path: str = params["model_path"]
view_name: str  = params["view"]
out_path: str   = params["out_path"]

log.info("Projecting view=%s  model=%s", view_name, model_path)
log.info("Output: %s", out_path)

# ── FreeCAD imports ───────────────────────────────────────────────────────────

try:
    import FreeCAD  # type: ignore[import]
    import FreeCADGui  # type: ignore[import]  # noqa: F401 — needed for TechDraw in some builds
    import Part  # type: ignore[import]
    import TechDraw  # type: ignore[import]
except ImportError as exc:
    log.error(
        "FreeCAD Python modules not available: %s\n"
        "This script must be run via freecadcmd.",
        exc,
    )
    sys.exit(2)

# ── View direction lookup ─────────────────────────────────────────────────────

def _iso_dir() -> FreeCAD.Vector:
    """Unit vector pointing from the isometric viewpoint toward the origin."""
    v = FreeCAD.Vector(1, -1, 1)
    mag = math.sqrt(v.x**2 + v.y**2 + v.z**2)
    return FreeCAD.Vector(v.x / mag, v.y / mag, v.z / mag)


_VIEW_DIRECTIONS: dict[str, tuple[FreeCAD.Vector, FreeCAD.Vector]] = {
    #            direction vector               up vector
    "top":   (FreeCAD.Vector(0,  0,  1), FreeCAD.Vector(0, 1, 0)),
    "front": (FreeCAD.Vector(0, -1,  0), FreeCAD.Vector(0, 0, 1)),
    "side":  (FreeCAD.Vector(1,  0,  0), FreeCAD.Vector(0, 0, 1)),
    "iso":   (_iso_dir(),                FreeCAD.Vector(0, 0, 1)),
}

if view_name not in _VIEW_DIRECTIONS:
    log.error(
        "Unknown view '%s'. Supported views: %s",
        view_name,
        ", ".join(_VIEW_DIRECTIONS),
    )
    sys.exit(1)

direction, up_dir = _VIEW_DIRECTIONS[view_name]

# ── Load the 3D model ─────────────────────────────────────────────────────────

doc = FreeCAD.newDocument("hw_gen_stage2")

try:
    if model_path.lower().endswith(".fcstd"):
        doc = FreeCAD.openDocument(model_path)
        # Gather all Part features in the document
        shapes = [o for o in doc.Objects if hasattr(o, "Shape")]
    else:
        # STEP or IGES — use Import.insert (Part.insert is deprecated in newer FreeCAD)
        try:
            import Import  # type: ignore[import]
            Import.insert(model_path, doc.Name)
        except ImportError:
            Part.insert(model_path, doc.Name)  # fallback for older builds
        doc.recompute()
        shapes = [o for o in doc.Objects if hasattr(o, "Shape")]
except Exception as exc:  # noqa: BLE001
    log.error("Failed to load model '%s': %s", model_path, exc)
    sys.exit(2)

if not shapes:
    log.error("No Part features found in model: %s", model_path)
    sys.exit(2)

log.info("Loaded %d shape(s) from model.", len(shapes))

# ── Generate SVG projection ───────────────────────────────────────────────────
# Strategy: try TechDraw first (best quality, available FreeCAD >= 0.19),
# then fall back to Part.makeShapeString / Drawing workbench approach for
# older installations.

# Import the shared, command-aware bbox parser from the pipeline package.
# (freecadcmd runs a stock CPython, so a pure-stdlib sibling module imports fine.)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.svg_crop import compute_bbox  # noqa: E402

# Visual line weight as a fraction of the larger viewBox dimension, so every
# standard renders with the same apparent stroke regardless of part size.
# TechDraw emits a fixed absolute stroke-width (≈0.7mm) that looks chunky on
# small parts and thin on large ones; normalising to the bbox fixes both.
_STROKE_FRACTION = 0.012
_STROKE_MIN_MM = 0.08
_STROKE_MAX_MM = 0.5


def _normalize_stroke_width(fragment: str, w: float, h: float) -> str:
    """Rewrite the group's absolute stroke-width to scale with the bbox."""
    stroke = max(w, h) * _STROKE_FRACTION
    stroke = max(_STROKE_MIN_MM, min(_STROKE_MAX_MM, stroke))
    return re.sub(
        r'stroke-width="[^"]*"',
        f'stroke-width="{stroke:.4f}"',
        fragment,
        count=1,
    )


def _wrap_svg_fragment(fragment: str) -> str:
    """Wrap a bare <g>…</g> fragment in a complete SVG document."""
    x, y, w, h = compute_bbox(fragment)
    fragment = _normalize_stroke_width(fragment, w, h)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '
        f'width="{w:.3f}mm" height="{h:.3f}mm" '
        f'viewBox="{x:.3f} {y:.3f} {w:.3f} {h:.3f}">\n'
        f'{fragment}\n'
        '</svg>\n'
    )


def _try_techdraw(doc: FreeCAD.Document, shapes: list, svg_path: str) -> bool:
    """
    Attempt TechDraw-based SVG export.  Returns True on success.

    TechDraw can produce SVG output without a running GUI since FreeCAD 0.20
    provided that ``FreeCADGui.setupWithoutGUI()`` has been called (done
    automatically by freecadcmd on modern builds).
    """
    try:
        # Minimal A4 template — TechDraw requires a page + template pair.
        page = doc.addObject("TechDraw::DrawPage", "Page")
        template = doc.addObject("TechDraw::DrawSVGTemplate", "Template")

        # Use a blank built-in template so we don't depend on an external file.
        # The empty string causes TechDraw to use an empty A4 sheet.
        template.Template = ""
        page.Template = template

        # Create a view of the first shape.
        view = doc.addObject("TechDraw::DrawViewPart", "View")
        view.Source = shapes
        view.Direction = direction
        view.XDirection = up_dir      # controls rotation of the projected view
        view.Scale = 1.0
        page.addView(view)

        doc.recompute()
        # forcedUpdate() was removed in FreeCAD 1.x; recompute() is sufficient.

        # getSVG() was added after 1.1.x; use viewPartAsSvg(view) instead.
        if hasattr(page, "getSVG"):
            svg_content: str = page.getSVG()
        elif hasattr(TechDraw, "viewPartAsSvg"):
            svg_content = TechDraw.viewPartAsSvg(view)
        else:
            log.warning("No known SVG export method on this TechDraw build; trying fallback.")
            return False

        # viewPartAsSvg returns a bare <g> fragment, not a full SVG document.
        stripped = svg_content.lstrip()
        if not (stripped.startswith("<?xml") or stripped.startswith("<svg")):
            log.info("SVG content is a fragment; wrapping in <svg> document.")
            svg_content = _wrap_svg_fragment(svg_content)

        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg_content)
        log.info("TechDraw SVG written: %s", svg_path)
        return True

    except Exception as exc:  # noqa: BLE001
        log.warning("TechDraw projection failed (%s); trying fallback.", exc)
        return False


def _try_part_projection_fallback(
    doc: FreeCAD.Document, shapes: list, svg_path: str
) -> bool:
    """
    Fallback: use ``TechDraw.projectToSVG`` for a direct wire projection.

    Part.projectToSVG was removed in FreeCAD 1.x; TechDraw.projectToSVG is the
    equivalent on modern builds.
    """
    project_fn = getattr(TechDraw, "projectToSVG", None) or getattr(Part, "projectToSVG", None)
    if project_fn is None:
        log.error("Neither TechDraw.projectToSVG nor Part.projectToSVG is available.")
        return False
    try:
        compound = Part.makeCompound([s.Shape for s in shapes])
        svg_content: str = project_fn(compound, direction)
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg_content)
        log.info("projectToSVG SVG written: %s", svg_path)
        return True
    except Exception as exc:  # noqa: BLE001
        log.error("projectToSVG failed: %s", exc)
        return False


# Try each strategy in order of preference.
success = _try_techdraw(doc, shapes, out_path)
if not success:
    success = _try_part_projection_fallback(doc, shapes, out_path)

if not success:
    log.error("All SVG projection strategies failed.")
    sys.exit(2)

sys.exit(0)
