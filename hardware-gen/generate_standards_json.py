"""
Generate standards.json from the hardware config files in hardware-gen/config/.

Usage:
    python generate_standards_json.py          # validate, then write ../standards.json

Each ``config/*.yaml`` file is the single source of truth for the standards it
contains (catalog metadata + render recipes). standards.json is a generated
artifact — do not edit it by hand, and it is not committed (it is built at
deploy time by pages.yml).

Loading also validates the merged set of standards across all files (unique
ids, existing images, etc.) and exits non-zero on any problem, so this doubles
as the CI validation gate.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from pipeline.models import HardwareConfig, StandardSpec

HERE = Path(__file__).parent
CONFIG_DIR = HERE / "config"
REPO_ROOT = HERE.parent
OUT_JSON = REPO_ROOT / "standards.json"


def _collect_standards() -> list[tuple[StandardSpec, Path]]:
    """Load every config file and return (standard, source_path) pairs."""
    collected: list[tuple[StandardSpec, Path]] = []
    for path in sorted(CONFIG_DIR.glob("*.yaml")) + sorted(CONFIG_DIR.glob("*.yml")):
        with path.open(encoding="utf-8") as f:
            raw: dict[str, Any] = yaml.safe_load(f) or {}
        config = HardwareConfig.from_dict(raw, source_file=str(path))
        collected.extend((std, path) for std in config.standards)
    return collected


def _validate(collected: list[tuple[StandardSpec, Path]]) -> None:
    """Cross-check the merged set of standards; exit non-zero on any error."""
    errors: list[str] = []
    seen_ids: dict[str, Path] = {}
    seen_render_names: dict[str, Path] = {}

    for std, path in collected:
        where = f"{path.name}:{std.id}"

        if std.id in seen_ids:
            errors.append(
                f"{where}: duplicate id (also in {seen_ids[std.id].name})"
            )
        else:
            seen_ids[std.id] = path

        if not std.designations:
            errors.append(f"{where}: at least one designation is required")

        if std.image is not None:
            if not std.image.startswith("/"):
                errors.append(
                    f"{where}: image must be an absolute web path (got '{std.image}')"
                )
            elif not std.image.startswith("/hardware-gen/output/") and \
                    not (REPO_ROOT / std.image.lstrip("/")).is_file():
                errors.append(f"{where}: image file not found: {std.image}")

        for render in std.renders:
            if render.name in seen_render_names:
                errors.append(
                    f"{where}: duplicate render name '{render.name}' "
                    f"(also in {seen_render_names[render.name].name}) — "
                    "render names become output filenames and must be unique"
                )
            else:
                seen_render_names[render.name] = path

    if errors:
        print("ERROR: standards validation failed:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)


def _render(collected: list[tuple[StandardSpec, Path]]) -> str:
    output: list[dict[str, Any]] = []
    for std, _ in collected:
        entry: dict[str, Any] = {
            "id": std.id,
            "primarySystem": std.primary_system,
            "description": std.description,
            "designations": [
                {"system": d.system, "code": d.code} for d in std.designations
            ],
            "hardwareType": std.hardware_type,
        }
        if std.image is not None:
            entry["image"] = std.image
        if std.renders:
            render = std.renders[0]
            entry["renderViews"] = {
                view: f"/hardware-gen/output/{render.name}_{view}.svg"
                for view in render.pipeline.export_2d_views
            }
        output.append(entry)

    views_count = sum(len(e.get("renderViews", {})) for e in output)
    meta: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "standardsCount": len(output),
        "viewsCount": views_count,
    }
    lib_commit = os.environ.get("GIT_STDLIB_SHA")
    if lib_commit:
        meta["libCommit"] = lib_commit

    return json.dumps({"meta": meta, "standards": output}, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    collected = _collect_standards()
    _validate(collected)
    OUT_JSON.write_text(_render(collected), encoding="utf-8")
    print(f"Written: {OUT_JSON} ({len(collected)} standards)")


if __name__ == "__main__":
    main()
