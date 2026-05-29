"""
Fastener capability table — sizes and lengths per standard.

Reads the committed snapshot ``pipeline/fastener_capabilities.json`` (generated
by ``freecad_scripts/dump_fastener_capabilities.py`` and regenerated via
``hardware-gen dump-caps``).  No FreeCAD import; safe to use in any environment.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_CAPABILITIES_PATH = Path(__file__).parent / "fastener_capabilities.json"


@lru_cache(maxsize=1)
def load_capabilities() -> dict[str, dict[str, Any]]:
    """Return the full capabilities map ``{std_name: {category, sizes, lengths_by_size}}``.

    Raises ``RuntimeError`` if the snapshot file is missing or empty.
    """
    try:
        data = json.loads(_CAPABILITIES_PATH.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RuntimeError(
            f"Cannot read fastener capabilities snapshot {_CAPABILITIES_PATH}: {exc}\n"
            "Regenerate it with: hardware-gen dump-caps"
        ) from exc

    standards: dict[str, dict[str, Any]] = data.get("standards", {})
    if not standards:
        raise RuntimeError(
            f"Fastener capabilities snapshot {_CAPABILITIES_PATH} is empty — "
            "regenerate it with: hardware-gen dump-caps"
        )
    return standards


def get_standard_info(std_id: str) -> dict[str, Any] | None:
    """Return the capability dict for *std_id* (already uppercased), or None."""
    try:
        return load_capabilities().get(std_id)
    except RuntimeError:
        return None


def pick_default_size(sizes: list[str]) -> str:
    """Return the median size from *sizes* (representative mid-range choice)."""
    return sizes[len(sizes) // 2]


def pick_default_length(lengths: list[str]) -> str | None:
    """Return the ~10th-percentile length from *lengths*.

    Biased toward the smaller end: renders are visual aids and a short part
    is less cluttered than a long one.  Returns None for empty lists.
    """
    if not lengths:
        return None
    return lengths[max(0, len(lengths) // 10)]
