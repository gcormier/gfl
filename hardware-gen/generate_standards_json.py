"""
Generate standards.json from hardware-gen/config/standards_meta.yaml.

Usage:
    python generate_standards_json.py          # write ../standards.json
    python generate_standards_json.py --check  # verify committed file matches

The YAML is the single source of truth.  standards.json is a generated
artifact — do not edit it by hand.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).parent
META_YAML = HERE / "config" / "standards_meta.yaml"
OUT_JSON = HERE.parent / "standards.json"


def _load_standards() -> list[dict[str, Any]]:
    with META_YAML.open(encoding="utf-8") as f:
        data: dict[str, Any] = yaml.safe_load(f)

    output: list[dict[str, Any]] = []
    for entry in data["standards"]:
        designations = [
            {"system": d["system"], "code": str(d["code"])}
            for d in entry["designations"]
        ]
        output.append(
            {
                "id": entry["id"],
                "primarySystem": entry["primary_system"],
                "description": entry["description"],
                "designations": designations,
                "hardwareType": entry["hardware_type"],
                "image": entry["image"],
                "jscad": entry["jscad"],
            }
        )
    return output


def _render(standards: list[dict[str, Any]]) -> str:
    return json.dumps(standards, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if the committed standards.json differs from generated output",
    )
    args = parser.parse_args()

    generated = _render(_load_standards())

    if args.check:
        if not OUT_JSON.exists():
            print(f"ERROR: {OUT_JSON} does not exist. Run without --check to create it.")
            sys.exit(1)
        committed = OUT_JSON.read_text(encoding="utf-8")
        if generated == committed:
            print("OK: standards.json is up to date.")
        else:
            print("ERROR: standards.json is out of sync with standards_meta.yaml.")
            print("Run `python hardware-gen/generate_standards_json.py` and commit the result.")
            sys.exit(1)
    else:
        OUT_JSON.write_text(generated, encoding="utf-8")
        print(f"Written: {OUT_JSON}")


if __name__ == "__main__":
    main()
