"""
Typed data models for the YAML configuration schema.

The schema mirrors the expected YAML structure exactly so that downstream
code works with structured objects rather than raw dicts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# ── Supported export types ────────────────────────────────────────────────────

Export3DFormat = Literal["step", "fcstd"]
ViewName = Literal["top", "side", "front", "iso"]


# ── Per-fastener pipeline settings ────────────────────────────────────────────

@dataclass
class PipelineConfig:
    """Controls what the pipeline emits for a single fastener."""

    export_3d: Export3DFormat = "step"
    export_2d_views: list[ViewName] = field(default_factory=lambda: ["top"])

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PipelineConfig:
        return cls(
            export_3d=data.get("export_3d", "step"),
            export_2d_views=data.get("export_2d_views", ["top"]),
        )


# ── Single fastener definition ─────────────────────────────────────────────────

@dataclass
class FastenerSpec:
    """One fastener entry from the YAML ``fasteners`` list."""

    name: str
    standard: str       # e.g. "ISO4762", "DIN912"
    size: str           # e.g. "M8"
    length: int | None  # mm; None for items like washers that have no length
    pipeline: PipelineConfig

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FastenerSpec:
        pipeline_data = data.get("pipeline", {})
        return cls(
            name=data["name"],
            standard=data["standard"],
            size=data["size"],
            length=data.get("length"),          # optional for washers etc.
            pipeline=PipelineConfig.from_dict(pipeline_data),
        )


# ── Top-level config file ──────────────────────────────────────────────────────

@dataclass
class HardwareConfig:
    """Parsed representation of a single YAML config file."""

    source_file: str                          # filesystem path, for logging
    fasteners: list[FastenerSpec] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any], source_file: str = "<unknown>") -> HardwareConfig:
        fasteners = [FastenerSpec.from_dict(f) for f in data.get("fasteners", [])]
        return cls(source_file=source_file, fasteners=fasteners)
