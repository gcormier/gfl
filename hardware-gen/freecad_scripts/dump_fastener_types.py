"""
Dump / check the FreeCAD Fasteners workbench standard registry.

This script runs inside FreeCAD's bundled Python interpreter via:

    freecadcmd /path/to/dump_fastener_types.py

It introspects ``FastenerBase.FSFastenerTypeDB`` — the exact registry FreeCAD
validates a fastener's ``.Type`` enumeration against — and emits the set of
valid standard names grouped by category. That set is the *single source of
truth* for which ``id`` values the config YAML may use on a render: it is
derived from the workbench itself, not hand-maintained.

It reads its parameters from the ``HW_GEN_PARAMS`` environment variable (a JSON
object) so freecadcmd's own argument parser doesn't consume them.

Expected JSON keys:
    mode  : "dump" | "check"   — default "dump"
    path  : str                — snapshot file to write (dump) or compare (check)

Modes:
    dump   Write the live registry to ``path`` as JSON (used to (re)generate the
           committed snapshot when FreeCAD / the workbench is upgraded).
    check  Compare the live registry to the committed snapshot at ``path`` and
           exit non-zero if they have drifted (the CI "Both" recheck — the
           committed snapshot powers the fast no-FreeCAD validation gate, and
           this confirms it still matches the installed workbench).

Exit codes:
    0  — success (dump written, or check found no drift)
    1  — parameter / IO error
    2  — FreeCAD / workbench error
    3  — check found drift between live registry and committed snapshot
"""

from __future__ import annotations

import json
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="[dump-types] %(levelname)s %(message)s",
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

# ── Load the Fasteners workbench ───────────────────────────────────────────────

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
            import ScrewMaker  # type: ignore[import]  # noqa: F401 — side effect
            _loaded = True
            log.info("Loaded Fasteners workbench from: %s", _p)
            break
        except ImportError:
            sys.path.pop(0)

if not _loaded:
    log.error("Fasteners workbench not found — cannot read the type registry.")
    sys.exit(2)

# ── Build the live registry: {category: sorted, de-duped names} ────────────────

live: dict[str, list[str]] = {}
for category, fastener_type in FastenerBase.FSFastenerTypeDB.items():  # type: ignore[attr-defined]
    names = sorted(set(fastener_type.items))
    if names:  # skip empty categories (e.g. HeatSet, T-Slot)
        live[category] = names

payload = {
    "_README": (
        "Generated from the FreeCAD Fasteners workbench by "
        "freecad_scripts/dump_fastener_types.py — DO NOT EDIT BY HAND. "
        "This is the single source of truth for valid render `id`s; it mirrors "
        "the workbench's own .Type enumeration. Regenerate when FreeCAD or the "
        "Fasteners workbench is upgraded (the hardware-gen.yml generate job "
        "rechecks it live and fails on drift)."
    ),
    "freecad_version": ".".join(str(v) for v in __import__("FreeCAD").Version()[:3]),
    "types": live,
}

# ── Dispatch ───────────────────────────────────────────────────────────────────


def _flat(d: dict[str, list[str]]) -> set[str]:
    out: set[str] = set()
    for v in d.values():
        out.update(v)
    return out


if mode == "dump":
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    log.info("Wrote %d standard names across %d categories to %s",
             len(_flat(live)), len(live), path)
    sys.exit(0)

if mode == "check":
    try:
        with open(path, encoding="utf-8") as f:
            committed = json.load(f)
    except OSError as exc:
        log.error("Cannot read committed snapshot %s: %s", path, exc)
        sys.exit(1)

    committed_names = _flat(committed.get("types", {}))
    live_names = _flat(live)
    added = sorted(live_names - committed_names)      # workbench has, snapshot lacks
    removed = sorted(committed_names - live_names)     # snapshot has, workbench lacks

    if not added and not removed:
        log.info("Snapshot is in sync with the installed workbench (%d names).",
                 len(live_names))
        sys.exit(0)

    if added:
        log.error("Snapshot is STALE — workbench added: %s", ", ".join(added))
    if removed:
        log.error("Snapshot is STALE — workbench removed: %s", ", ".join(removed))
    log.error("Regenerate: run this script with mode='dump'.")
    sys.exit(3)

log.error("Unknown mode '%s' (expected 'dump' or 'check').", mode)
sys.exit(1)
