"""
Generate standards.json from the hardware config files in hardware-gen/config/.

Usage:
    python generate_standards_json.py          # write ../standards.json

Each ``config/*.yaml`` file is the single source of truth for the standards it
contains (catalog metadata + render recipes). standards.json is a generated
artifact — do not edit it by hand, and it is not committed (it is built at
deploy time by pages.yml).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from pipeline.models import HardwareConfig

HERE = Path(__file__).parent
CONFIG_DIR = HERE / "config"
OUT_JSON = HERE.parent / "standards.json"


def _load_standards() -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for path in sorted(CONFIG_DIR.glob("*.yaml")) + sorted(CONFIG_DIR.glob("*.yml")):
        with path.open(encoding="utf-8") as f:
            raw: dict[str, Any] = yaml.safe_load(f) or {}
        config = HardwareConfig.from_dict(raw, source_file=str(path))
        for std in config.standards:
            output.append(
                {
                    "id": std.id,
                    "primarySystem": std.primary_system,
                    "description": std.description,
                    "designations": [
                        {"system": d.system, "code": d.code} for d in std.designations
                    ],
                    "hardwareType": std.hardware_type,
                    "image": std.image,
                }
            )
    return output


def _render(standards: list[dict[str, Any]]) -> str:
    return json.dumps(standards, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    OUT_JSON.write_text(_render(_load_standards()), encoding="utf-8")
    print(f"Written: {OUT_JSON}")


if __name__ == "__main__":
    main()
