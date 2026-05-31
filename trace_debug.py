#!/usr/bin/env python3
"""
Standalone reproduction of the contribute-page image trace pipeline.

Applies the same threshold logic as image-trace.js and saves the
thresholded images so you can see exactly what the tracer is working with.

Usage:
    pip install Pillow
    python trace_debug.py <image.png> [threshold ...]

Example — sweep common thresholds:
    python trace_debug.py ferrule.png 41 80 100 128 160 200 245
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Install Pillow first:  pip install Pillow")


def threshold_image(img: Image.Image, threshold: int, white_fill: bool = True) -> Image.Image:
    """
    Mirrors the browser canvas logic in image-trace.js.

    white_fill=True  → transparent pixels treated as white (post-fix behaviour)
    white_fill=False → transparent pixels treated as black (pre-fix behaviour)
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    out = Image.new("RGB", (w, h), (255, 255, 255))
    out_px = out.load()
    in_px  = rgba.load()

    black = white = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = in_px[x, y]

            if white_fill and a < 128:
                # transparent → white (post canvas-fill fix)
                gray = 255
            else:
                # JS formula: 0.299*R + 0.587*G + 0.114*B
                # (alpha is ignored; transparent canvas pixels have R=G=B=0)
                gray = 0.299 * r + 0.587 * g + 0.114 * b

            v = 0 if gray < threshold else 255
            out_px[x, y] = (v, v, v)
            if v == 0:
                black += 1
            else:
                white += 1

    total = w * h
    return out, black, white, total


def pixel_histogram(img: Image.Image, bins: int = 16) -> str:
    """Simple ASCII brightness histogram."""
    gray = img.convert("L")
    counts = [0] * bins
    for px in gray.getdata():
        counts[min(px * bins // 256, bins - 1)] += 1
    total = sum(counts)
    lines = []
    for i, c in enumerate(counts):
        lo = i * 256 // bins
        hi = (i + 1) * 256 // bins - 1
        bar = "█" * int(40 * c / max(counts))
        lines.append(f"  {lo:3d}-{hi:3d}: {bar} {100*c/total:5.1f}%")
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    img_path = Path(sys.argv[1])
    if not img_path.exists():
        sys.exit(f"File not found: {img_path}")

    thresholds = [int(t) for t in sys.argv[2:]] if len(sys.argv) > 2 else [41, 80, 100, 128, 160, 200, 245]

    img = Image.open(img_path)
    print(f"\nImage: {img_path.name}  {img.size[0]}×{img.size[1]}  mode={img.mode}")
    print("\nBrightness histogram of original (L channel):")
    print(pixel_histogram(img))

    out_dir = img_path.parent / (img_path.stem + "_debug")
    out_dir.mkdir(exist_ok=True)

    print(f"\nThresholded images → {out_dir}/\n")
    print(f"{'Threshold':>9}  {'Black%':>6}  {'White%':>6}  {'Verdict'}")
    print("-" * 50)

    for t in thresholds:
        thresh_img, black, white, total = threshold_image(img, t, white_fill=True)
        black_pct = 100 * black / total
        white_pct = 100 * white / total

        if black_pct < 1:
            verdict = "⚠ almost nothing traced"
        elif black_pct > 80:
            verdict = "⚠ mostly black — silhouette likely"
        elif black_pct > 50:
            verdict = "⚠ a lot of black — details may merge"
        else:
            verdict = "✓ looks reasonable"

        print(f"{t:>9}  {black_pct:>5.1f}%  {white_pct:>5.1f}%  {verdict}")

        out_path = out_dir / f"thresh_{t:03d}.png"
        thresh_img.save(out_path)

    print(f"\nOpen the images in {out_dir}/ and find the threshold where")
    print("the outlines are crisp black on white WITHOUT the interior areas filling in.")


if __name__ == "__main__":
    main()
