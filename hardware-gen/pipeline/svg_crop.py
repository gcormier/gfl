"""
Tight bounding-box computation and re-cropping for TechDraw SVG output.

Pure stdlib (``re`` only) so it can be imported both from the normal venv and
from inside ``freecadcmd``'s bundled interpreter (stage2_2d.py).

The TechDraw projection produces geometry whose true extent is small, but a
naive "treat every number in d= as x/y" parser mistakes arc parameters
(rx, ry, rotation, flags) for coordinates and inflates the viewBox massively.
This module parses path commands properly so the crop is tight.
"""

from __future__ import annotations

import re

# Matches a path command letter OR a number (incl. scientific notation).
_TOKEN_RE = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")
# Argument count per command (after the first M/m, extra coord pairs are L/l).
_ARGC = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def _accumulate_path_points(d: str, add) -> None:
    """Parse one path ``d`` string, calling ``add(x, y)`` for every point that
    bounds the geometry (endpoints and Bezier control points, which contain
    their curves)."""
    tokens = _TOKEN_RE.findall(d)
    i, n = 0, len(tokens)
    cx = cy = sx = sy = 0.0
    cmd = ""

    def nxt() -> float:
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < n:
        if tokens[i].isalpha():
            cmd = tokens[i]
            i += 1
            if cmd in ("Z", "z"):
                cx, cy = sx, sy
                continue
        elif not cmd:
            i += 1
            continue
        # Implicit repeat: after M/m the trailing pairs are line-to.
        if cmd == "M":
            cmd = "L"
        elif cmd == "m":
            cmd = "l"

        rel = cmd.islower()
        c = cmd.upper()
        if i + _ARGC.get(c, 0) > n:
            break

        if c == "M" or c == "L" or c == "T":
            x, y = nxt(), nxt()
            if rel:
                x += cx
                y += cy
            cx, cy = x, y
            if c == "M":
                sx, sy = x, y
            add(x, y)
        elif c == "H":
            x = nxt()
            cx = cx + x if rel else x
            add(cx, cy)
        elif c == "V":
            y = nxt()
            cy = cy + y if rel else y
            add(cx, cy)
        elif c == "C":
            x1, y1, x2, y2, x, y = (nxt() for _ in range(6))
            if rel:
                x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy
            add(x1, y1); add(x2, y2); add(x, y)
            cx, cy = x, y
        elif c == "S" or c == "Q":
            x1, y1, x, y = (nxt() for _ in range(4))
            if rel:
                x1 += cx; y1 += cy; x += cx; y += cy
            add(x1, y1); add(x, y)
            cx, cy = x, y
        elif c == "A":
            # rx ry rotation large-arc-flag sweep-flag x y — only x/y are points.
            nxt(); nxt(); nxt(); nxt(); nxt()
            x, y = nxt(), nxt()
            if rel:
                x += cx
                y += cy
            add(x, y)
            cx, cy = x, y
        else:
            i += 1


def _attrs(tag: str) -> dict[str, str]:
    return dict(re.findall(r'(\w+)\s*=\s*"([^"]*)"', tag))


def compute_bbox(svg_text: str, pad_frac: float = 0.04, pad_min: float = 0.5):
    """Return a tight ``(x, y, width, height)`` for all drawable geometry in
    *svg_text*. Padding is a fraction of the larger dimension (min ``pad_min``).
    Falls back to a 200×200 box centred on the origin if nothing parses."""
    xs: list[float] = []
    ys: list[float] = []

    def add(x: float, y: float) -> None:
        xs.append(x)
        ys.append(y)

    for m in re.finditer(r'\bd\s*=\s*"([^"]*)"', svg_text):
        _accumulate_path_points(m.group(1), add)

    for m in re.finditer(r"<(?:ellipse|circle)\b[^>]*>", svg_text):
        a = _attrs(m.group(0))
        try:
            ccx = float(a.get("cx", 0))
            ccy = float(a.get("cy", 0))
            # Conservative extent: largest radius (covers any rotation).
            r = max(float(a.get("rx", 0)), float(a.get("ry", 0)), float(a.get("r", 0)))
        except ValueError:
            continue
        add(ccx - r, ccy - r)
        add(ccx + r, ccy + r)

    for m in re.finditer(r"<line\b[^>]*>", svg_text):
        a = _attrs(m.group(0))
        try:
            add(float(a.get("x1", 0)), float(a.get("y1", 0)))
            add(float(a.get("x2", 0)), float(a.get("y2", 0)))
        except ValueError:
            continue

    if not xs or not ys:
        return -100.0, -100.0, 200.0, 200.0

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    w, h = max_x - min_x, max_y - min_y
    pad = max(pad_frac * max(w, h), pad_min)
    return min_x - pad, min_y - pad, w + 2 * pad, h + 2 * pad


def recrop_svg(svg_text: str) -> str:
    """Recompute the ``<svg>`` width/height/viewBox of *svg_text* from a tight
    bbox of its geometry, leaving the body untouched."""
    x, y, w, h = compute_bbox(svg_text)

    def repl(m: re.Match) -> str:
        head = m.group(0)
        head = re.sub(r'\bwidth\s*=\s*"[^"]*"', f'width="{w:.3f}mm"', head)
        head = re.sub(r'\bheight\s*=\s*"[^"]*"', f'height="{h:.3f}mm"', head)
        head = re.sub(
            r'\bviewBox\s*=\s*"[^"]*"',
            f'viewBox="{x:.3f} {y:.3f} {w:.3f} {h:.3f}"',
            head,
        )
        return head

    return re.sub(r"<svg\b[^>]*>", repl, svg_text, count=1)


def _main(argv: list[str]) -> int:
    """``python -m pipeline.svg_crop FILE...`` — recrop the given SVGs in place."""
    if not argv:
        print("usage: python -m pipeline.svg_crop FILE.svg [FILE.svg ...]")
        return 1
    for path in argv:
        with open(path, encoding="utf-8") as f:
            original = f.read()
        cropped = recrop_svg(original)
        if cropped != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(cropped)
            print(f"recropped {path}")
        else:
            print(f"unchanged {path}")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(_main(sys.argv[1:]))
