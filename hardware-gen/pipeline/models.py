"""
Typed data models for the YAML configuration schema.

Each ``config/*.yaml`` file describes one class of hardware (``nuts.yaml``,
``bolts_screws.yaml``, ``washers.yaml``, ``misc.yaml``). A file holds a list of
*standards*; each standard carries both its catalog metadata (description,
designations, image) and an optional list of *render* recipes (the part
instances the CAD pipeline builds). This is the single source of truth — both
``generate.py`` (geometry) and ``generate_standards_json.py`` (catalog) read it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

# ── Supported export types ────────────────────────────────────────────────────

Export3DFormat = Literal["step", "fcstd"]
ViewName = Literal["top", "side", "front", "iso"]

# ── hardware_type inferred from the config filename stem ───────────────────────
# misc.yaml is intentionally absent: its entries are heterogeneous and must
# declare ``hardware_type`` explicitly.

HARDWARE_TYPE_BY_FILE: dict[str, str] = {
    "nuts": "nut",
    "washers": "washer",
    "bolts_screws": "screw",
}


# ── Per-render pipeline settings ──────────────────────────────────────────────

@dataclass
class PipelineConfig:
    """Controls what the pipeline emits for a single render."""

    export_3d: Export3DFormat = "step"
    export_2d_views: list[ViewName] = field(default_factory=lambda: ["top"])

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PipelineConfig:
        return cls(
            export_3d=data.get("export_3d", "step"),
            export_2d_views=data.get("export_2d_views", ["top"]),
        )


# ── Cross-reference designation (system + code) ───────────────────────────────

@dataclass
class Designation:
    """One system/code pair, e.g. ISO 4762 or DIN 912."""

    system: str
    code: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Designation:
        return cls(system=data["system"], code=str(data["code"]))


# ── A single part instance to build (formerly the whole YAML entry) ───────────

@dataclass
class RenderSpec:
    """One part instance the CAD pipeline should generate for a standard."""

    name: str
    size: str           # e.g. "M8"
    length: int | None  # mm; None for items like washers that have no length
    pipeline: PipelineConfig

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RenderSpec:
        return cls(
            name=data["name"],
            size=data["size"],
            length=data.get("length"),
            pipeline=PipelineConfig.from_dict(data.get("pipeline", {})),
        )


# ── A hardware standard: catalog metadata + its renders ───────────────────────

@dataclass
class StandardSpec:
    """One standard entry from a config file's ``standards`` list.

    ``id`` is the canonical identifier (lowercase). Uppercasing it yields the
    FreeCAD Fasteners workbench standard name used to build geometry, so the id
    must match that name (e.g. ``iso7380-1``, not ``iso7380``).
    """

    id: str
    primary_system: str
    description: str
    hardware_type: str
    designations: list[Designation]
    image: str | None
    renders: list[RenderSpec] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any], default_hardware_type: str | None) -> StandardSpec:
        std_id = data["id"]
        hardware_type = data.get("hardware_type") or default_hardware_type
        if not hardware_type:
            raise ValueError(
                f"standard '{std_id}' has no hardware_type and none could be "
                "inferred from the filename — add a hardware_type field"
            )
        return cls(
            id=std_id,
            primary_system=data["primary_system"],
            description=data["description"],
            hardware_type=hardware_type,
            designations=[Designation.from_dict(d) for d in data["designations"]],
            image=data.get("image"),
            renders=[RenderSpec.from_dict(r) for r in data.get("renders", [])],
        )


# ── A single fastener to feed the CAD engine (flattened standard + render) ────

@dataclass
class FastenerSpec:
    """A standard's id paired with one render — the unit the CAD engine builds."""

    name: str
    standard: str       # canonical standard id; resolved to a FreeCAD name
    size: str
    length: int | None
    pipeline: PipelineConfig


# ── Top-level config file ──────────────────────────────────────────────────────

@dataclass
class HardwareConfig:
    """Parsed representation of a single YAML config file."""

    source_file: str                          # filesystem path, for logging
    standards: list[StandardSpec] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any], source_file: str = "<unknown>") -> HardwareConfig:
        default_hardware_type = HARDWARE_TYPE_BY_FILE.get(Path(source_file).stem)
        standards = [
            StandardSpec.from_dict(s, default_hardware_type)
            for s in data.get("standards", [])
        ]
        return cls(source_file=source_file, standards=standards)

    def fastener_specs(self) -> list[FastenerSpec]:
        """Flatten every standard's renders into engine-ready fastener specs."""
        specs: list[FastenerSpec] = []
        for std in self.standards:
            for render in std.renders:
                specs.append(
                    FastenerSpec(
                        name=render.name,
                        standard=std.id,
                        size=render.size,
                        length=render.length,
                        pipeline=render.pipeline,
                    )
                )
        return specs
