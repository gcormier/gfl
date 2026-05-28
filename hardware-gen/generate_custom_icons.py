"""
Generate custom-icons.json from the SVG files in images/custom/.

Usage:
    python generate_custom_icons.py          # write ../custom-icons.json
    python generate_custom_icons.py --check  # verify committed file matches + validate

The images/custom/*.svg files are the single source of truth. custom-icons.json
is a generated artifact — do not edit it by hand. Each contributed SVG must
carry its own metadata so the manifest can be rebuilt from the directory alone:

    <svg ...>
      <title>Hex Wrench</title>            <!-- name (required) -->
      <desc>tool, allen, hardware</desc>    <!-- comma-separated keywords (required) -->
      <path d="..."/>                       <!-- at least one path (required) -->
    </svg>

The frontend (catalog.js) reads only the first <path d="…"> from each file.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
ICONS_DIR = HERE.parent / "images" / "custom"
OUT_JSON = HERE.parent / "custom-icons.json"

SVG_NS = "{http://www.w3.org/2000/svg}"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class IconError(Exception):
    """A single SVG failed validation. Message is contributor-facing."""


def _parse_icon(path: Path) -> dict[str, Any]:
    stem = path.stem
    if not ID_RE.match(stem):
        raise IconError(
            f"{path.name}: filename must be lowercase letters/digits/dashes "
            f"(got '{stem}')."
        )

    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        raise IconError(f"{path.name}: not valid XML/SVG ({exc}).") from exc

    name = (root.findtext(f"{SVG_NS}title") or "").strip()
    if not name:
        raise IconError(f"{path.name}: missing a non-empty <title> (the icon name).")

    desc = (root.findtext(f"{SVG_NS}desc") or "").strip()
    tags = [t.strip() for t in desc.split(",") if t.strip()]
    if not tags:
        raise IconError(
            f"{path.name}: missing <desc> keywords "
            "(comma-separated terms used for search)."
        )

    has_path = any(
        el.tag == f"{SVG_NS}path" and el.get("d")
        for el in root.iter()
    )
    if not has_path:
        raise IconError(f"{path.name}: contains no <path d=\"…\"> element.")

    return {"id": stem, "name": name, "file": path.name, "tags": tags}


def _load_icons() -> list[dict[str, Any]]:
    if not ICONS_DIR.is_dir():
        return []

    icons: list[dict[str, Any]] = []
    errors: list[str] = []
    for path in sorted(ICONS_DIR.glob("*.svg")):
        try:
            icons.append(_parse_icon(path))
        except IconError as exc:
            errors.append(str(exc))

    if errors:
        print("ERROR: one or more custom icons failed validation:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)

    return icons


def _render(icons: list[dict[str, Any]]) -> str:
    return json.dumps(icons, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if committed custom-icons.json differs or any SVG is invalid",
    )
    args = parser.parse_args()

    generated = _render(_load_icons())

    if args.check:
        if not OUT_JSON.exists():
            print(f"ERROR: {OUT_JSON} does not exist. Run without --check to create it.")
            sys.exit(1)
        committed = OUT_JSON.read_text(encoding="utf-8")
        if generated == committed:
            print("OK: custom-icons.json is up to date.")
        else:
            print("ERROR: custom-icons.json is out of sync with images/custom/.")
            print("Run `python hardware-gen/generate_custom_icons.py` and commit the result.")
            sys.exit(1)
    else:
        OUT_JSON.write_text(generated, encoding="utf-8")
        print(f"Written: {OUT_JSON}")


if __name__ == "__main__":
    main()
