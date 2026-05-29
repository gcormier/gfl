# Gridfinity Label Generator

A browser-based label generator for [Gridfinity](https://www.youtube.com/watch?v=ra_9zU-mnl8) storage bins. Design and print labels with hardware standard drawings, [Material Design Icons](https://pictogrammers.com/library/mdi/), or your own custom SVG icons — directly to a **Brother PT-P710BT** label printer over USB.



**Live app:** [gcormier.github.io/gfl](https://gcormier.github.io/gfl/)

## Features

- Search a catalog of **DIN / ISO fastener standards** with automatic cross-references
- Render technical drawings, MDI icons, or custom SVG icons on the label
- Switch between generated ISO / top / side views for hardware standards
- Generate images as code using [FreeCAD Fasteners Workbench](https://wiki.freecad.org/Fasteners_Workbench)
- Freeform text mode for general-purpose labels
- Optional QR code with a link back to the standard
- Supports 4 mm – 24 mm Brother TZe tape widths
- Real-time canvas preview with accurate print margins
- Favorites system with import/export
- Batch printing with a queue

## Design Goals

The hardware-standards pipeline is built around two principles:

1. **Standards as code (OpenSCAD).** Fastener geometry is defined as version-controlled
   code rather than hand-drawn assets. The direction is **OpenSCAD** — lightweight,
   text-based parametric CAD — so geometry can be reviewed in a PR like any other source.
2. **Single source of truth.** Every fact about a standard lives in one place; the
   `standards.json` catalog and rendered images are *generated* from that source, never
   edited directly.

## Print Agent

The **Print Agent** is a small local Python server that receives rendered label PNGs from the web app and sends them directly to the printer over USB — no P-touch Editor or Windows print spooler required.

See [print-agent/README.md](print-agent/README.md) for full details.

### Quick Start

1. Install [UV](https://docs.astral.sh/uv/) (manages Python + dependencies automatically):
   ```
   # Windows
   winget install astral-sh.uv

   # Linux / macOS
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. Set up USB access for the printer (one-time — see below).

3. Run the agent:
   ```
   cd print-agent
   uv run agent.py
   ```
   The agent listens on `http://localhost:9100`. Keep it running while printing; stop with **Ctrl-C**.

### Why Zadig? (Windows)

On Windows the Brother printer is normally claimed by the Windows Print Spooler driver. The spooler has known stability issues when streaming multi-page RAW batches — it regularly crashes or stalls mid-print.

[Zadig](https://zadig.akeo.ie/) replaces the stock driver with **libusbK**, which lets the print agent talk directly to the printer over USB via PyUSB, bypassing the spooler entirely. This is more reliable and gives full control over the Brother raster protocol.

**Setup (one-time):**

1. Download and run [Zadig](https://zadig.akeo.ie/).
2. Enable **Options → List All Devices**.
3. Select **PT-P710BT** from the dropdown.
4. Set the target driver to **libusbK** (not WinUSB — PyUSB supports libusbK natively without extra DLLs).
5. Click **Replace Driver**.

### Linux USB Setup

Create a udev rule so the printer is accessible without root:

```bash
sudo tee /etc/udev/rules.d/99-brother-pt.rules <<'EOF'
SUBSYSTEM=="usb", ATTRS{idVendor}=="04f9", ATTRS{idProduct}=="20af", MODE="0666"
EOF
sudo udevadm control --reload-rules && sudo udevadm trigger
```

## Contributing

Contributions are welcome via **pull request**. Please do not push directly to `main`.

1. Fork the repository.
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes and commit.
4. Open a pull request against `main`.

### Adding Custom Icons

Custom SVG icons live in the `images/custom/` folder. The SVG file **is** the source of
truth — its name and search keywords are carried inside the SVG itself, and the
`custom-icons.json` catalog is generated from it at deploy time (never edit or commit
that file). To add a new icon:

1. Create an SVG file with a `0 0 24 24` viewBox containing a single `<path>`, plus a
   `<title>` (display name) and `<desc>` (comma-separated search keywords). Save it to
   `images/custom/my-icon.svg`. Or author one in the browser via `contribute.html`.
2. Open a PR with **just the SVG**. On merge, the deploy regenerates `custom-icons.json`
   and your icon goes live — no JSON edit needed.

> **Tip:** To preview locally, run `uv run python generate_custom_icons.py` from the
> `hardware-gen/` directory to build a working-tree `custom-icons.json`, then load the app
> and select your icon from the Custom icon source.

#### SVG Icon Guidelines

Icons are rendered as filled paths via `Path2D` using the **nonzero winding** fill rule, then printed at **180 DPI** on a 1-bit monochrome thermal printer. Keep these constraints in mind:

| Guideline | Detail |
|---|---|
| **Coordinate space** | Design to a **24 × 24** viewBox. All coordinates in the `d` string must fit this grid. |
| **Single path only** | The renderer uses a single SVG `d` attribute — no `<circle>`, `<rect>`, gradients, strokes, or embedded images. Convert everything to one compound path. |
| **Transparent background** | Do not include a background fill rectangle. The label background is white; only black-filled regions print. |
| **Monochrome / 1-bit** | The printer has no greyscale. Design with solid black fills only — no thin anti-aliased strokes. |
| **Minimum feature size** | On 12 mm tape the icon area is ~70 dots tall (≈ 1 dot per 0.34 viewBox units). Details smaller than **~1 unit** in the 24 × 24 space may disappear. On 6 mm tape (~32 dots) the limit is **~1.5 units**. |
| **Line / stroke weight** | If your design has outlines, make them at least **1.5 units** wide so they survive the 180 DPI rasterization. |
| **Fill rule** | The canvas `fill()` uses **nonzero winding**. To cut holes (e.g. a ring), draw the outer contour in one direction and the inner contour in the opposite direction. |
| **Test at target size** | Preview on the smallest tape width you intend to use. Fine details that look good on 24 mm tape may be unreadable on 6 mm. |

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

You are free to use, modify, and distribute this software **for non-commercial purposes**. Any modified versions must also be released under the same license and make their source code available. **Commercial use is not permitted** without explicit permission from the author.

See [LICENSE](LICENSE) for the full text.
