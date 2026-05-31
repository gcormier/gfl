# hardware-gen

Headless hardware 3D/2D generation pipeline using FreeCAD and the Fasteners workbench.

## Prerequisites

### Python dependencies

```bash
uv sync
```

### FreeCAD (required for the `freecad` engine)

FreeCAD is **not** installed via `uv` or pip — it ships its own bundled Python interpreter, and mixing it with a normal venv causes import conflicts. Instead, install it separately on the host and point the tool at the binary via the `FREECADCMD` environment variable.

#### Why AppImage?

The `freecad` apt package was removed from Ubuntu 24.04 (Noble) repos and is unreliable across distro versions. The official AppImage:

- Works on any Linux (Ubuntu 22.04, 24.04, GitHub Actions runners)
- Is self-contained — no apt, no PPA, no snap daemon required
- Gives you a pinned FreeCAD version that doesn't change under you

#### Install (local and CI)

1. Download the latest stable AppImage from the [FreeCAD releases page](https://github.com/FreeCAD/FreeCAD/releases/latest). Look for a file named like `FreeCAD_<version>-conda-Linux-x86_64.AppImage`.

2. Make it executable and place it somewhere on your system:

    ```bash
    chmod +x FreeCAD_*.AppImage
    mv FreeCAD_*.AppImage ~/bin/FreeCAD.AppImage   # or any path you prefer
    ```

3. Export the path to `freecadcmd` mode (the AppImage's console entry point):

    ```bash
    export FREECADCMD="~/bin/FreeCAD.AppImage --console"
    ```

    Add this to your `~/.bashrc` or `~/.profile` to persist it.

> **Note:** If your system doesn't have FUSE (required by AppImage), run with
> `--appimage-extract-and-run` instead of `--console`:
> ```bash
> export FREECADCMD="~/bin/FreeCAD.AppImage --appimage-extract-and-run --console"
> ```

#### GitHub Actions

In your workflow, download the AppImage, make it executable, then set `FREECADCMD`:

```yaml
- name: Install FreeCAD AppImage
  run: |
    curl -L -o FreeCAD.AppImage \
      "https://github.com/FreeCAD/FreeCAD/releases/download/<version>/FreeCAD_<version>-conda-Linux-x86_64.AppImage"
    chmod +x FreeCAD.AppImage
    echo "FREECADCMD=$(pwd)/FreeCAD.AppImage --appimage-extract-and-run --console" >> $GITHUB_ENV
```

Replace `<version>` with the pinned release tag. Using `--appimage-extract-and-run` avoids needing to install `libfuse2` on the runner.

### Fasteners workbench (required)

The [FreeCAD Fasteners workbench](https://github.com/shaise/FreeCAD_FastenersWB) provides the accurate ISO/DIN fastener geometry. The generator **will not start** without it.

The workbench is a FreeCAD addon — it is not bundled with FreeCAD itself and must be installed separately to the FreeCAD user Mod directory.

#### Install (local, headless)

```bash
mkdir -p ~/.local/share/FreeCAD/Mod
git clone https://github.com/shaise/FreeCAD_FastenersWB \
    ~/.local/share/FreeCAD/Mod/Fasteners
```

This path (`~/.local/share/FreeCAD/Mod/Fasteners`) is the first entry in the generator's search list and works with both AppImage and system FreeCAD installs on Linux.

If your FreeCAD version uses the older data path, use `~/.FreeCAD/Mod/` instead:

```bash
mkdir -p ~/.FreeCAD/Mod
git clone https://github.com/shaise/FreeCAD_FastenersWB \
    ~/.FreeCAD/Mod/Fasteners
```

#### Install (GitHub Actions / CI)

Add a step before the generation step. The path written to `FASTENERS_PATH` is picked up directly by the generator so no system-wide install is needed:

```yaml
- name: Install Fasteners workbench
  run: |
    git clone --depth 1 https://github.com/shaise/FreeCAD_FastenersWB \
        /tmp/FreeCAD_FastenersWB
    echo "FASTENERS_PATH=/tmp/FreeCAD_FastenersWB" >> $GITHUB_ENV
```

#### Override path

If the workbench lives somewhere else, point the generator at it directly:

```bash
export FASTENERS_PATH=/path/to/FreeCAD_FastenersWB
```

## Usage

```bash
# Process all YAML config files
uv run generate.py

# Process a specific config
uv run generate.py config/fasteners.yaml

# Use the FreeCAD engine explicitly
uv run generate.py --engine freecad --verbose config/fasteners.yaml

# Dry run (validate config without invoking FreeCAD)
uv run generate.py --dry-run config/fasteners.yaml
```

Output files are written to `./build/` (3D solids) and `./output/` (2D SVGs).
