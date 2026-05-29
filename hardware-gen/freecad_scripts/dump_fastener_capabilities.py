"""
Dump / check the FreeCAD Fasteners workbench capability table.

This script runs inside FreeCAD's bundled Python interpreter via:

    freecadcmd /path/to/dump_fastener_capabilities.py

For every standard registered in the workbench it records the valid size
strings (``GetAllDiams``) and the valid length strings per size
(``GetAllLengths``). The result is written as a committed JSON snapshot that
the pipeline and ``hw-gen scaffold`` use without requiring FreeCAD at authoring
time.

It reads its parameters from the ``HW_GEN_PARAMS`` environment variable (a JSON
object) so freecadcmd's own argument parser doesn't consume them.

Expected JSON keys:
    mode  : "dump" | "check"   — default "dump"
    path  : str                — snapshot file to write (dump) or compare (check)

Modes:
    dump   Write the live capability table to ``path`` as JSON.
    check  Compare the live table to the committed snapshot at ``path`` and
           exit non-zero if they have drifted (used in CI to detect workbench
           upgrades that add/remove standards or change their valid sizes).

Exit codes:
    0  — success (dump written, or check found no drift)
    1  — parameter / IO error
    2  — FreeCAD / workbench error
    3  — check found drift between live table and committed snapshot
"""

from __future__ import annotations

import json
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="[dump-caps] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Parameter ingestion ───────────────────────────────────────────────────────

raw = os.environ.get("HW_GEN_PARAMS", "{}")
try:
    params: dict = json.loads(raw)
except json.JSONDecodeError as exc:
    log.error("Failed to parse HW_GEN_PARAMS JSON: %s", exc)
    sys.exit(1)

mode: str = params.get("mode", "dump")
path: str = params.get("path", "")
if not path:
    log.error("HW_GEN_PARAMS must include a 'path' to write/compare.")
    sys.exit(1)

# ── Load the Fasteners workbench ──────────────────────────────────────────────

_FASTENERS_SEARCH_PATHS: list[str] = [
    os.path.expanduser("~/.local/share/FreeCAD/Mod/Fasteners"),
    os.path.expanduser("~/.FreeCAD/Mod/Fasteners"),
    "/usr/share/freecad/Mod/Fasteners",
    "/usr/lib/freecad/Mod/Fasteners",
    os.environ.get("FASTENERS_PATH", ""),
]

_loaded = False
for _p in _FASTENERS_SEARCH_PATHS:
    if _p and os.path.isdir(_p):
        sys.path.insert(0, _p)
        try:
            import FastenerBase  # type: ignore[import]
            import FastenersCmd  # type: ignore[import]  # noqa: F401 — registers all types
            import ScrewMaker  # type: ignore[import]
            _loaded = True
            log.info("Loaded Fasteners workbench from: %s", _p)
            break
        except ImportError:
            sys.path.pop(0)

if not _loaded:
    log.error("Fasteners workbench not found — cannot read capability table.")
    sys.exit(2)

# ── Build the live capability table ──────────────────────────────────────────
# For each registered standard, record the valid size strings and, for each
# size, the valid length strings.  Standards with no length property (e.g.
# washers, retaining rings) get an empty lengths_by_size dict.

live: dict[str, dict] = {}

for category, fastener_type in FastenerBase.FSFastenerTypeDB.items():  # type: ignore[attr-defined]
    for std_name in sorted(set(fastener_type.items)):
        try:
            sizes: list[str] = ScrewMaker.Instance.GetAllDiams(std_name)  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001
            log.warning("GetAllDiams(%s) failed: %s — skipping", std_name, exc)
            continue

        lengths_by_size: dict[str, list[str]] = {}
        for size in sizes:
            try:
                lengths: list[str] = ScrewMaker.Instance.GetAllLengths(  # type: ignore[attr-defined]
                    std_name, size, addCustom=False
                )
                if lengths:
                    lengths_by_size[size] = lengths
            except Exception as exc:  # noqa: BLE001
                log.debug("GetAllLengths(%s, %s) failed: %s — treating as no-length", std_name, size, exc)

        live[std_name] = {
            "category": category,
            "sizes": sizes,
            "lengths_by_size": lengths_by_size,
        }

log.info("Collected capability data for %d standards.", len(live))

payload = {
    "_README": (
        "Generated from the FreeCAD Fasteners workbench by "
        "freecad_scripts/dump_fastener_capabilities.py — DO NOT EDIT BY HAND. "
        "Records valid size strings and lengths-per-size for every registered "
        "standard. Used by `hw-gen scaffold` (no FreeCAD needed at authoring "
        "time) and validated in CI for drift after FreeCAD/workbench upgrades. "
        "Regenerate: hardware-gen dump-caps"
    ),
    "freecad_version": ".".join(str(v) for v in __import__("FreeCAD").Version()[:3]),
    "standards": live,
}

# ── Dispatch ──────────────────────────────────────────────────────────────────


def _sizes_snapshot(data: dict) -> dict[str, list[str]]:
    """Extract {std_name: sizes} from a payload dict for drift comparison."""
    return {k: v["sizes"] for k, v in data.get("standards", {}).items()}


if mode == "dump":
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    log.info("Wrote capability data for %d standards to %s", len(live), path)
    sys.exit(0)

if mode == "check":
    try:
        with open(path, encoding="utf-8") as f:
            committed = json.load(f)
    except OSError as exc:
        log.error("Cannot read committed snapshot %s: %s", path, exc)
        sys.exit(1)

    live_snap = _sizes_snapshot({"standards": live})
    committed_snap = _sizes_snapshot(committed)

    added   = sorted(set(live_snap) - set(committed_snap))
    removed = sorted(set(committed_snap) - set(live_snap))

    # Also check for any standard whose size list changed.
    changed = sorted(
        k for k in live_snap
        if k in committed_snap and live_snap[k] != committed_snap[k]
    )

    if not added and not removed and not changed:
        log.info("Snapshot is in sync with the installed workbench (%d standards).", len(live_snap))
        sys.exit(0)

    if added:
        log.error("Snapshot is STALE — workbench added standards: %s", ", ".join(added))
    if removed:
        log.error("Snapshot is STALE — workbench removed standards: %s", ", ".join(removed))
    if changed:
        log.error("Snapshot is STALE — sizes changed for: %s", ", ".join(changed))
    log.error("Regenerate: run hardware-gen dump-caps")
    sys.exit(3)

log.error("Unknown mode '%s' (expected 'dump' or 'check').", mode)
sys.exit(1)
