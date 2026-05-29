"""
Standards registry and validation.

Policy: a render's ``id`` (uppercased) **is** the FreeCAD Fasteners workbench
standard name. There is no hand-maintained DIN→ISO remap table — that would be
external knowledge the workbench doesn't encode, and silently rewriting an id
would make the built geometry drift from the declared id and its render
filenames. Instead the set of valid names is *derived from the workbench
itself*: ``freecad_scripts/dump_fastener_types.py`` introspects the workbench's
own ``FSFastenerTypeDB`` (the exact registry FreeCAD validates ``.Type``
against) into the committed snapshot ``pipeline/fastener_types.json``.

``resolve_standard`` only normalises case/whitespace. ``validate_standard``
checks membership against that snapshot, so an unrenderable name (e.g.
``ISO7980``, which the workbench doesn't ship) fails at the fast no-FreeCAD
validation gate with actionable hints — instead of as an opaque enumeration
error mid-render. The error distinguishes between a standard that is real but
unimplemented by the workbench (most common: drop ``renders:`` to go
catalog-only, or contribute a custom image) versus a likely typo (the "did you
mean" hint). The
``generate`` CI job additionally rechecks the snapshot live against the
installed workbench (``dump_fastener_types.py`` ``mode=check``) so the snapshot
can't silently go stale after a FreeCAD/workbench upgrade.

Only standards that actually render are validated — catalog-only entries never
reach the workbench, so they may carry real-world identifiers (e.g. DIN 2093
Belleville washers) that the Fasteners workbench does not implement.
"""

from __future__ import annotations

import difflib
import json
import logging
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

# Committed snapshot of the workbench registry (generated, never hand-edited).
_SNAPSHOT_PATH = Path(__file__).parent / "fastener_types.json"


class UnknownStandardError(ValueError):
    """Raised when a render's standard id is not a FreeCAD workbench name."""


@lru_cache(maxsize=1)
def known_standards() -> frozenset[str]:
    """Return the set of valid workbench standard names from the snapshot.

    Derived from the workbench by ``dump_fastener_types.py``; this just reads
    the committed JSON so the lightweight validation gate needs no FreeCAD.
    """
    try:
        data = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RuntimeError(
            f"Cannot read workbench standards snapshot {_SNAPSHOT_PATH}: {exc}\n"
            "Regenerate it with freecad_scripts/dump_fastener_types.py (mode=dump)."
        ) from exc
    names: set[str] = set()
    for category_names in data.get("types", {}).values():
        names.update(category_names)
    if not names:
        raise RuntimeError(
            f"Workbench standards snapshot {_SNAPSHOT_PATH} is empty — regenerate it."
        )
    return frozenset(names)


def resolve_standard(raw: str) -> str:
    """Normalise a standard string to the workbench's canonical form.

    Uppercase, strip surrounding whitespace, drop internal spaces. Hyphens are
    preserved because the workbench uses them in multi-part names
    (e.g. ``ISO7380-1``). No DIN→ISO remap happens here — see module docstring.
    """
    return raw.strip().upper().replace(" ", "")


def validate_standard(name: str) -> None:
    """Raise :class:`UnknownStandardError` if *name* is not a workbench standard.

    *name* must already be normalised via :func:`resolve_standard`.
    """
    known = known_standards()
    if name in known:
        return
    suggestion = difflib.get_close_matches(name, known, n=1, cutoff=0.6)
    workbench_hint = (
        f"\n  → If you intended a different workbench standard, "
        f"did you mean '{suggestion[0]}'? (closest match in workbench registry)"
        if suggestion else ""
    )
    raise UnknownStandardError(
        f"'{name}' is a valid standard, but the FreeCAD Fasteners workbench does "
        f"not implement it — rendering is not possible.\n"
        f"  → To keep it in the catalog without a render, remove the `renders:` "
        f"block from this entry.\n"
        f"  → If you want a visual anyway, contribute a custom SVG via "
        f"contribute.html and set `image:` on the entry manually."
        f"{workbench_hint}\n"
        f"  → If you upgraded FreeCAD/Fasteners, regenerate the snapshot: "
        f"freecad_scripts/dump_fastener_types.py mode=dump"
    )
