"""
Stage 1 – 3D solid generation.

This script is executed inside FreeCAD's bundled Python interpreter via:

    freecadcmd /path/to/stage1_3d.py

It reads its parameters from the ``HW_GEN_PARAMS`` environment variable
(a JSON object) so that freecadcmd's own argument parser doesn't consume them.

Expected JSON keys:
    standard  : str   — resolved ISO standard code, e.g. "ISO4762"
    size      : str   — thread designation, e.g. "M8"
    length    : int|null — nominal length in mm (None for washers etc.)
    out_path  : str   — absolute path for the output file
    format    : str   — "step" or "fcstd"

Exit codes:
    0  — success
    1  — parameter / validation error
    2  — FreeCAD / workbench error
"""

from __future__ import annotations

import json
import logging
import os
import sys

_GREEN = "\033[32m"
_RED   = "\033[31m"
_BOLD  = "\033[1m"
_RESET = "\033[0m"

logging.basicConfig(
    level=logging.INFO,
    format="[stage1] %(levelname)s %(message)s",
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

standard: str        = params["standard"]
size: str            = params["size"]
length: int | None   = params.get("length")
out_path: str        = params["out_path"]
fmt: str             = params.get("format", "step")

log.info("Generating: standard=%s  size=%s  length=%s", standard, size, length)
log.info("Output: %s", out_path)

# ── FreeCAD imports ───────────────────────────────────────────────────────────
# These are only available when this script runs under freecadcmd.

try:
    import FreeCAD  # type: ignore[import]
    import Part  # type: ignore[import]
except ImportError as exc:
    log.error(
        "FreeCAD Python modules not available: %s\n"
        "This script must be run via freecadcmd, not a regular Python interpreter.",
        exc,
    )
    sys.exit(2)

# ── Fasteners workbench discovery ─────────────────────────────────────────────
# The Fasteners workbench is a FreeCAD addon.  It may live in the user addon
# directory, a system path, or a CI-installed location.

_FASTENERS_SEARCH_PATHS: list[str] = [
    # User addon directory (FreeCAD 0.20+)
    os.path.expanduser("~/.local/share/FreeCAD/Mod/Fasteners"),
    # Older Linux user path
    os.path.expanduser("~/.FreeCAD/Mod/Fasteners"),
    # System install (some distros package the addon)
    "/usr/share/freecad/Mod/Fasteners",
    "/usr/lib/freecad/Mod/Fasteners",
    # Explicit override for CI / Docker images
    os.environ.get("FASTENERS_PATH", ""),
]

_fasteners_path: str | None = None

for _path in _FASTENERS_SEARCH_PATHS:
    if _path and os.path.isdir(_path):
        sys.path.insert(0, _path)
        try:
            import ScrewMaker  # type: ignore[import]  # noqa: F401 — side-effect import
            _fasteners_path = _path
            log.info("%s%sLoaded Fasteners workbench from:%s %s", _BOLD, _GREEN, _RESET, _path)
            break
        except ImportError:
            sys.path.pop(0)

if _fasteners_path is None:
    log.error(
        "%s%sFasteners workbench not found%s — cannot generate geometry.\n"
        "Install it to one of the search paths above, or set FASTENERS_PATH.\n"
        "See hardware-gen/README.md for headless install instructions.",
        _BOLD, _RED, _RESET,
    )
    sys.exit(2)

try:
    from FastenersCmd import FSScrewObject  # type: ignore[import]
except ImportError as exc:
    log.error("%s%sFailed to import FastenersCmd:%s %s", _BOLD, _RED, _RESET, exc)
    sys.exit(2)


# ── Geometry generation ───────────────────────────────────────────────────────

doc = FreeCAD.newDocument("hw_gen_stage1")

try:
    feat = doc.addObject("Part::FeaturePython", standard)
    FSScrewObject(feat, standard, None)
    feat.Diameter = size
    if length is not None and hasattr(feat, "Length"):
        length_str = str(length)
        available = list(feat.Length)
        if length_str in available:
            feat.Length = length_str
        else:
            log.warning("Length %s not in available lengths %s; using default.", length_str, available)
    doc.recompute()
    log.info("%s%sFastener created via Fasteners workbench:%s %s %s", _BOLD, _GREEN, _RESET, standard, size)
except Exception as exc:  # noqa: BLE001
    log.error("%s%sFastener creation failed:%s %s", _BOLD, _RED, _RESET, exc)
    sys.exit(2)

# Export in the requested format
try:
    if fmt == "fcstd":
        doc.saveAs(out_path)
        log.info("Saved FreeCAD document: %s", out_path)
    else:  # default: STEP
        Part.export([feat], out_path)
        log.info("Exported STEP: %s", out_path)
except Exception as exc:  # noqa: BLE001
    log.error("Export failed: %s", exc)
    sys.exit(2)

sys.exit(0)
