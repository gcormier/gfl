# Agent Instructions & Architecture

## Application Summary

**Gridfinity Label Generator** is a browser-based tool for designing and printing custom labels for Gridfinity storage bins. Users compose labels with text, icons, and parametric JSCAD geometry outlines, then print them directly to a Brother PT-P710BT label printer.

**Technical Stack:**
- **Frontend**: Pure client-side JavaScript (no build step), hosted on GitHub Pages. Core modules handle rendering (`renderer.js`), JSCAD geometry evaluation in a Web Worker (`jscad-worker.js`), icon/standard catalog browsing (`catalog.js`), and the GitHub contribution flow (`github-contrib.js`).
- **Print Agent**: A local Python HTTP server (`print-agent/agent.py`) running on `localhost:9100` via `uv run`. It receives base64 PNG label images from the browser and converts them to Brother raster protocol data for USB printing.
- **Standards**: The `standards.json` catalog defines the available hardware label standards and is rendered in the app from each standard's generated SVG `image` (produced by the FreeCAD pipeline into `hardware-gen/output/`). `standards.json` is a **generated file** — source of truth is the per-hardware-type configs in `hardware-gen/config/` (`bolts_screws.yaml`, `nuts.yaml`, `washers.yaml`, `misc.yaml`; geometry from the FreeCAD pipeline). Standards are no longer user-contributable in the browser.
- **Custom images**: Community-contributed icons live in `images/custom/*.svg` and surface under **Icon → Custom**. The `custom-icons.json` manifest is a **generated file** — source of truth is the SVGs themselves (name/keywords carried in each SVG's `<title>`/`<desc>`). Authored and submitted via `contribute.html`.

---

This file contains architectural notes, file breakdowns, and mandatory operational rules for any LLM agent working in this repository.

## 🚨 MANDATORY ATOMIC RULES (FOR ALL AGENTS)

Whenever you (an AI agent) modify files in this repository, you **MUST** adhere to the following rules as a single atomic operation:

1. **Website Changes -> Increment Web Site Version**
   If you modify any frontend files (HTML, CSS, JS, JSON), you must increment the version number in:
   - The `VERSION` file in the root directory.
   - The `APP_VERSION` constant in `app.js`.
   - Note: `contribute.html` reads the version dynamically from the `VERSION` file — no code change needed there.

2. **Print Agent Changes -> Increment Print Agent Version**
   If you modify the print agent backend (`print-agent/agent.py`), you must increment its version number in:
   - `print-agent/agent.py` (look for the `# version: x.x.x` comment string).

3. **Always Commit & Push**
   Any time you touch/modify a file or complete a requested change, you **MUST** run a `git commit` and `git push` without waiting for the user to prompt you:
   ```bash
   git add .
   git commit -m "Brief commit message explaining the change"
   git push
   ```

4. **Use `uv` instead of `pip`**
   Always use `uv` as the Python package manager. Never use bare `pip` or `pip install`. Use `uv pip install`, `uv run`, `uv venv`, etc. This applies to code, scripts, documentation, and READMEs.

---

## Architecture Overview

* **Frontend (Web Site)**: A static browser-based application (Gridfinity Label Generator) that generates and previews custom labels using an HTML `<canvas>`. 
* **Backend (Print Agent)**: A local Python-based HTTP server bridging the web app and a Brother PT-P710BT label printer over USB. It runs via `uv run agent.py` on `localhost:9100` and converts base64 PNGs into Brother raster protocol data.

## JavaScript File Breakdown

To help navigate the frontend codebase quickly, here is the breakdown of the core JS modules:

- **`app.js`**: The main entry point. Handles global state management, user preferences (localStorage), and overarching application configuration (including the `APP_VERSION` constant).
- **`catalog.js`**: Fetches the design standards (`standards.json`) and manages the search/filtering functionalities for the standard catalog pane. Also exposes `setJscadResult()` for the JSCAD editor to inject geometry into the label pipeline.
- **`printer.js`**: Contains the logic and UI behaviors for printing, polling local Print Agents (`pollAgentStatus`), managing the print queue, and dealing with remote USB paths.
- **`renderer.js`**: The rendering engine. Handles drawing the user-selected icons, text layout, scaling onto the front-end `<canvas>` element, and rendering JSCAD geometry outlines via `drawJscadOutlines()`.
- **`jscad-editor.js`**: The custom-image designer on `contribute.html`. Manages the in-browser JSCAD code editor, spawns `jscad-worker.js` to evaluate code, displays the geometry preview, and exports the result as a single-path SVG. Submitting hands that SVG to `github-contrib.js`. (Not loaded by the main app.)
- **`jscad-worker.js`**: A Web Worker that safely evaluates user-supplied JSCAD code in a sandboxed context (no DOM access). Imports the `@jscad/modeling` library via `importScripts`, runs the code, and posts back the resulting geometry or an error.
- **`image-trace.js`**: Converts a raster image (bitmap) into a set of vector outlines suitable for use as a JSCAD standard. Implements Ramer–Douglas–Peucker simplification, SVG path parsing, and canvas-based pixel tracing.
- **`github-contrib.js`**: Handles the custom-image "Contribute" flow. Takes the exported SVG, injects `<title>`/`<desc>` metadata (name + keywords) collected in the modal, and builds a GitHub "create new file" URL pre-filled with a single `images/custom/<id>.svg` file, then opens it in a new tab — no OAuth or backend required; GitHub's own UI handles the fork/PR flow.

## Hardware Standards Workflow

### Design Goals

Two principles drive the direction of this workflow. Weigh changes against them:

1. **Standards as code (OpenSCAD).** Hardware geometry should be defined as plain,
   version-controllable code. The long-term target is **OpenSCAD** — text-based
   parametric CAD that is lighter than the FreeCAD AppImage and runnable inside a
   CI/deploy step — replacing the current FreeCAD + Fasteners Workbench pipeline.
2. **Single source of truth.** Each fact about a standard lives in exactly one place
   (the source YAML / geometry code). Derived artifacts (`standards.json`,
   `custom-icons.json`, rendered images) are *generated*, never authored.

> **Generated artifacts are NOT committed.** `standards.json` and `custom-icons.json`
> are **not stored in git** (they are `.gitignore`d). Committing a generated *text*
> file back to `main` would make it a merge surface — every concurrent PR that
> regenerated it would conflict and need a rebase + re-generate. Instead they are
> **built at deploy time** by `pages.yml`, so contributors only ever edit the source.
> The CAD-rendered geometry (the SVG `image`s under `hardware-gen/output/`) is the one
> exception that stays committed — it's expensive to build (FreeCAD), so the
> `hardware-gen.yml` bot renders and commits it rather than rebuilding on every deploy.
> This holds until the toolchain (OpenSCAD goal) is light enough to render at deploy too.

`standards.json` (root) is a **generated, git-ignored artifact** — never edit it by
hand and never commit it.

**Source of truth**: the per-hardware-type files in `hardware-gen/config/` —
`bolts_screws.yaml`, `nuts.yaml`, `washers.yaml`, `misc.yaml`. (There is no separate
metadata file; the old `standards_meta.yaml` was merged into these.)

Each file holds a `standards:` list. A standard entry carries **both** its catalog
metadata and its geometry recipe, so the two can't drift apart:

```yaml
# nuts.yaml  → hardware_type "nut" inferred from the filename
standards:
  - id: iso4032                 # uppercased, this IS the FreeCAD standard name
    description: "Fasteners - Hexagon regular nuts (style 1)"
    designations:
      - { system: ISO, code: "4032" }
      - { system: DIN, code: "934" }
    renders:                    # optional — omit/empty for catalog-only standards
      - size: M8                # length too, for items that have one
        views: [top]
```

Key rules:
- **`id` ⇒ FreeCAD name *and* render filename.** Geometry is built from `id.upper()`
  (via `resolve_standard`), so the id must equal the FreeCAD Fasteners workbench name —
  e.g. `iso7380-1`, **not** `iso7380`. Renders inherit the standard from their parent
  `id`; they do **not** repeat it. A render's output filename stem also **defaults to the
  `id`** (e.g. `iso4032_top.svg`); set an optional `name:` on a render only to disambiguate
  when a standard has more than one render.
- **`image` is inferred**, not authored — it's the first render's first view
  (`/hardware-gen/output/<name>_<firstview>.svg`). Set an explicit `image:` on a standard
  only as an override (e.g. a custom catalog-only thumbnail).
- **The first view in `views:` controls the catalog thumbnail.** The order of views in the
  list determines which view shows up in the web app's standards list — the first entry is
  the catalog image. This is intentional: put `iso` first for a 3D-looking thumbnail, or
  `top` first for a flat technical view, depending on what best represents the part at a
  glance. Example: `views: [iso, top]` renders both but uses the isometric as the catalog
  image; swapping to `views: [top, iso]` makes the top view the thumbnail instead.
- **`hardware_type` is inferred from the filename** (`nuts`→nut, `washers`→washer,
  `bolts_screws`→screw) via `HARDWARE_TYPE_BY_FILE` in `pipeline/models.py`. `misc.yaml`
  has no inferred type, so its entries must set `hardware_type` explicitly. Any entry may
  override the inferred value with an explicit `hardware_type`.
- **Auto designation display is ISO-first.** The catalog picks the ISO designation when one
  exists, else falls back to whatever is present — there is no `primary_system` field.
- **`renders` is optional.** A standard with no render recipe is catalog-only (shows in
  the list, builds no geometry). A render is just `size` + `views` (+ `length` where it
  applies); the 3D intermediate is always STEP.

To add or modify a standard:
1. Edit the matching `hardware-gen/config/*.yaml`. The render `image` is derived from the
   `id` — you do **not** author it or render the SVG by hand.
2. Commit **only** the YAML — open a PR. Do **not** generate or commit `standards.json`
   or the SVGs.
3. On merge to `main`, `hardware-gen.yml` renders the geometry and commits the
   `hardware-gen/output/*.svg`, then dispatches `pages.yml`, which regenerates
   `standards.json` into the deploy. The standard goes live.

To preview locally, run `uv run python generate_standards_json.py` from the `hardware-gen/`
directory to produce a working-tree `standards.json` (git-ignored), then load the app.

CI (`hardware-gen.yml`) runs the generators on every push/PR touching `hardware-gen/config/`,
`images/custom/`, or the generators — as a **validation gate** (they exit non-zero on
malformed YAML or invalid SVG metadata). There is no committed JSON to diff against.
`generate_standards_json.py` additionally cross-checks the merged set of standards across
all config files and fails on: duplicate `id`s, a missing/empty `designations` list, an
`image` that isn't an absolute web path (or, for paths outside `/hardware-gen/output/`,
whose file doesn't exist on disk — pipeline-rendered SVGs are exempt, since CI generates
them), or duplicate render `name`s (they become output filenames). This is what makes "build but don't list"
(or a renamed-but-not-updated image) impossible to merge.

Standards render in the app from each entry's committed SVG `image` (a view
produced by the FreeCAD pipeline into `hardware-gen/output/`). Standards with no
render recipe have no `image` and show without a thumbnail.

---

## Custom Images Workflow

`custom-icons.json` (root) is a **generated, git-ignored artifact** — never edit it by
hand and never commit it.

**Source of truth**: the SVG files in `images/custom/`. Each SVG carries its own
metadata: `<title>` = display name, `<desc>` = comma-separated search keywords.
The frontend reads only the first `<path d="…">` from each file.

To add or modify a custom image:
1. Add/edit an SVG under `images/custom/` (or author one via `contribute.html`).
2. Commit **only** the SVG — open a PR. Do **not** generate or commit `custom-icons.json`.
3. On merge to `main`, `pages.yml` regenerates `custom-icons.json` into the deploy.

To preview locally, run `uv run python generate_custom_icons.py` from the `hardware-gen/` directory.

The generator validates each SVG (non-empty `<title>`, at least one `<desc>`
keyword, at least one `<path d>`, conforming filename) and fails CI otherwise — it
runs in the `hardware-gen.yml` dry-run job purely as that validation gate.

---

## CI/CD Pipelines (GitHub Actions)

Two workflows live in `.github/workflows/`. Both carry real deployment logic — read this before editing either, since changes can publish to GitHub Pages or push commits back to `main`.

### `pages.yml` — Deploy to GitHub Pages

Publishes the static site (the entire repo root) to GitHub Pages.

- **Triggers**: push to `main` (ignoring `print-agent/**`, which is never deployed) and manual `workflow_dispatch`.
- **Concurrency**: group `pages`, `cancel-in-progress: true` — a newer push supersedes an in-flight deploy.
- **Permissions**: `pages: write`, `id-token: write` (required by `deploy-pages`).
- **Steps**: `checkout` → `setup-uv` → `uv sync` (in `hardware-gen`) → **generate `standards.json` + `custom-icons.json`** → `configure-pages` → `upload-pages-artifact` (path `.`, the whole repo) → `deploy-pages`.
- **Implication**: anything committed to `main` outside `print-agent/` ships to the live site. `standards.json` and `custom-icons.json` are **generated here at deploy time** (not stored in git) from their sources; the committed `hardware-gen/output/*.svg` files are served as-is.

### `hardware-gen.yml` — Hardware artifact generation & validation

Lints, validates, and (on relevant pushes) regenerates the FreeCAD-derived hardware artifacts, committing the resulting SVGs back to the repo so Pages can serve them.

- **Triggers**: push **and** pull_request touching `hardware-gen/config/**`, `hardware-gen/freecad_scripts/**`, `hardware-gen/pipeline/**` (render/crop logic), `hardware-gen/generate_custom_icons.py`, `images/custom/**`, `custom-icons.json`, or the workflow file itself; plus `workflow_dispatch` with an optional `config_file` input (empty = process all configs).
- **Concurrency**: group `hardware-gen-${{ github.ref }}`, `cancel-in-progress: true` — one run per branch to avoid clobbering the artifact cache; other branches run independently.
- **Jobs run sequentially (`needs`)**: `lint` → `dry-run` → `generate`.

1. **`lint`** (no FreeCAD): `uv sync --dev`, then `ruff check .` and `mypy generate.py pipeline/`. Working dir `hardware-gen`.
2. **`dry-run`** (no FreeCAD): parses/validates YAML via `generate.py --dry-run`, then runs `generate_standards_json.py` and `generate_custom_icons.py` (no `--check`) as a **validation gate** — they parse the source YAML and validate every SVG's metadata, failing CI on malformed input. They no longer diff against a committed JSON (there isn't one — it's generated at deploy time).
3. **`generate`** (requires FreeCAD, `contents: write` + `actions: write`): downloads & extracts the FreeCAD 1.1.1 AppImage to `/opt/freecad` (cached by URL), installs the Fasteners workbench (cached weekly via a `%Y-%U` key), runs `generate.py` headless (`QT_QPA_PLATFORM=offscreen`, `FREECADCMD` pointed at the extracted binary). Uploads STEP and SVG artifacts (30-day retention), then **commits the regenerated `hardware-gen/output/*.svg` back to the repo** as `github-actions[bot]` with `[skip ci]` and pushes. When SVGs changed, it then **dispatches `pages.yml`** (`gh workflow run`) so the new geometry ships to Pages.

**Caching notes**: the FreeCAD AppImage cache key is the download URL — bump `FREECAD_APPIMAGE_URL` to upgrade FreeCAD and the cache invalidates automatically. The Fasteners workbench cache rotates weekly so upstream fixes get picked up without manual cache busting.

**Why the explicit `pages.yml` dispatch**: the bot's `git push` authenticates with `GITHUB_TOKEN`, and GitHub never starts new workflow runs from `GITHUB_TOKEN` pushes (recursion guard) — `[skip ci]` on the commit reinforces that. So the SVG commit alone would never deploy. `workflow_dispatch` is **exempt** from the recursion guard, so the `generate` job explicitly runs `gh workflow run pages.yml --ref main` (only when SVGs actually changed) to ship them. `[skip ci]` is still kept on the commit so it doesn't retrigger `hardware-gen.yml`. Net effect on a standard merge: `pages.yml` first deploys the new `standards.json` (briefly referencing a not-yet-committed SVG), then this dispatch fires a second deploy ~1–2 min later that includes the SVG — self-healing, no manual deploy needed.

