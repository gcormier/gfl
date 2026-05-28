"""
Standards registry and ISO-first enforcement.

Policy: DIN standards that have a direct ISO equivalent are remapped to the
ISO standard automatically, and a warning is emitted.  This keeps library
outputs consistent and avoids duplicate assets for equivalent geometry.

FreeCAD Fasteners workbench standard names are used verbatim as the
canonical identifiers (they match the ISO/DIN number without spaces).
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

# ── DIN → ISO mapping ─────────────────────────────────────────────────────────
# Keys are the DIN designations users might type; values are the preferred ISO.
# Sourced from the FreeCAD Fasteners workbench standard list.

DIN_TO_ISO: dict[str, str] = {
    # Socket cap screws
    "DIN912":  "ISO4762",
    # Hex head screws (full thread)
    "DIN933":  "ISO4017",
    # Hex head screws (partial thread)
    "DIN931":  "ISO4014",
    # Hex nuts
    "DIN934":  "ISO4032",
    # Thin hex nuts
    "DIN439":  "ISO4035",
    # Prevailing-torque thin hex nuts (nyloc thin)
    "DIN985":  "ISO10511",
    # Prevailing-torque hex nuts (nyloc full)
    "DIN982":  "ISO7042",
    # Plain washers (normal series)
    "DIN125A": "ISO7089",
    "DIN125B": "ISO7090",
    # Spring lock washers
    "DIN127":  "ISO7980",
    # Countersunk socket screws
    "DIN7991": "ISO10642",
    # Slotted cheese head screws
    "DIN84":   "ISO1207",
    # Slotted countersunk flat head screws
    "DIN963":  "ISO2009",
    # Slotted pan head screws
    "DIN85":   "ISO1580",
    # Cross-recessed pan head screws
    "DIN7985": "ISO7045",
    # Hexagon set screws (cup point)
    "DIN916":  "ISO4029",
    # Hexagon set screws (flat point)
    "DIN913":  "ISO4026",
    # Hexagon set screws (dog point)
    "DIN915":  "ISO4028",
    # Stud bolts
    "DIN938":  "ISO4031",
}


def resolve_standard(raw: str) -> str:
    """
    Normalise a standard string and enforce the ISO-first policy.

    Returns the canonical standard identifier to pass to the CAD engine.
    Logs a warning if the input was a DIN standard that was remapped.
    """
    # Normalise: strip whitespace, uppercase, remove internal spaces
    normalised = raw.strip().upper().replace(" ", "").replace("-", "")

    if normalised in DIN_TO_ISO:
        iso_equiv = DIN_TO_ISO[normalised]
        log.warning(
            "Standard '%s' remapped to ISO equivalent '%s'. "
            "Prefer ISO standards in your YAML config.",
            raw,
            iso_equiv,
        )
        return iso_equiv

    return normalised
