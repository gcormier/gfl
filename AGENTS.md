# Agent Instructions & Architecture

## Application Summary

**Gridfinity Label Generator** is a browser-based tool for designing and printing custom labels for Gridfinity storage bins. Users compose labels with text, icons, and parametric JSCAD geometry outlines, then print them directly to a Brother PT-P710BT label printer.

**Technical Stack:**
- **Frontend**: Pure client-side JavaScript (no build step), hosted on GitHub Pages. Core modules handle rendering (`renderer.js`), JSCAD geometry evaluation in a Web Worker (`jscad-worker.js`), icon/standard catalog browsing (`catalog.js`), and the GitHub contribution flow (`github-contrib.js`).
- **Web Serial (primary print path)**: The browser sends raster data directly to the Brother PT-P710BT over Bluetooth via the Web Serial API (Chrome/Edge desktop). No drivers, no Zadig, no USB cable, no local agent required — just pair the printer via Bluetooth and click Connect & Print.
- **Print Agent (USB fallback)**: A local Python HTTP server (`print-agent/agent.py`) running on `localhost:9100` via `uv run`. It receives base64 PNG label images from the browser and converts them to Brother raster protocol data for USB printing. Use this only when Bluetooth is unavailable.
- **Standards**: The `standards.json` catalog defines the available hardware label standards and is rendered in the app from each standard's generated SVG `image` (produced by the FreeCAD pipeline into `hardware-gen/output/`). `standards.json` is a **generated file** — source of truth is the per-hardware-type configs in `hardware-gen/config/` (`bolts_screws.yaml`, `nuts.yaml`, `washers.yaml`, `misc.yaml`; geometry from the FreeCAD pipeline). Standards are no longer user-contributable in the browser.
- **Custom images**: Community-contributed icons live in `images/custom/*.svg` and surface under **Icon → Custom**. The `custom-icons.json` manifest is a **generated file** — source of truth is the SVGs themselves (name/keywords carried in each SVG's `<title>`/`<desc>`). Authored and submitted via `contribute.html`.

---

This file contains architectural notes, file breakdowns, and mandatory operational rules for any LLM agent working in this repository.

## 🚨 MANDATORY ATOMIC RULES (FOR ALL AGENTS)

Whenever you (an AI agent) modify files in this repository, you **MUST** adhere to the following rules as a single atomic operation:

1. **Website Version — DO NOT hand-bump**
   The web version is **display-only** (topbar pill + `contribute.html`) and is
   **derived at deploy time** by `pages.yml` from the deployed commit
   (`YYYY.MM.DD+<short-sha>`). The **`VERSION` file is not tracked** — it's `.gitignore`d
   and *written* into the deploy artifact by `pages.yml` (local dev simply has no file;
   `contribute.html`'s fetch fails gracefully). The `APP_VERSION` constant in `app.js` ships
   as a static `dev` placeholder and is overwritten in the artifact only. **Never create or
   increment them** — a hand-bumped number would be a merge surface across concurrent PRs
   (the same reason `standards.json` is generated, not committed). Just edit the frontend;
   the version takes care of itself.

2. **Print Agent Changes -> Increment Print Agent Version**
   If you modify the print agent backend (`print-agent/agent.py`), increment its version in the
   single `__version__ = "x.x.x"` constant near the top of `print-agent/agent.py` (the startup
   banner reads from it — there is exactly one place). Unlike the web version, this is a plain
   hand-set release number: the agent is run directly by users (`uv run agent.py`) with no
   deploy/build step to derive a version into, and the value is informational only (the browser
   never reads it). Bump it deliberately when cutting an agent release.

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
* **Web Serial (primary print path)**: The browser communicates directly with the Brother PT-P710BT label printer over Bluetooth via the Web Serial API. No drivers, no Zadig, no USB cable, and no local agent needed — pair via Bluetooth and print. Requires Chrome or Edge on desktop.
* **Print Agent (USB fallback)**: A local Python-based HTTP server bridging the web app and the printer over USB. It runs via `uv run agent.py` on `localhost:9100` and converts base64 PNGs into Brother raster protocol data. Use when Bluetooth/Web Serial is unavailable.

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
  (via `resolve_standard`, which only normalises case/whitespace — there is no DIN→ISO
  remap), so the id must equal the FreeCAD Fasteners workbench name *exactly* —
  e.g. `iso7380-1`, **not** `iso7380`; `asmeb18.2.1.6`, **not** `asmeb18.2.1`. For any
  standard that **renders**, the id is validated against the workbench's own registry —
  the committed `pipeline/fastener_types.json` snapshot, which is *generated from the
  workbench* by `freecad_scripts/dump_fastener_types.py` (it mirrors the `.Type`
  enumeration FreeCAD itself validates against). An id that isn't a workbench name fails
  the dry-run gate with a "did you mean" hint, instead of as an opaque error mid-render.
  **Catalog-only standards are exempt** (they never reach the workbench), so they may use
  real-world identifiers the Fasteners workbench doesn't implement (e.g. `din2093`
  Belleville washers, `din127` split-lock washers). Renders inherit the standard from
  their parent `id`; they do **not** repeat it. A render's output filename stem also
  **defaults to the `id`** (e.g. `iso4032_top.svg`); set an optional `name:` on a render
  only to disambiguate when a standard has more than one render.
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

Three workflows live in `.github/workflows/`. `hardware-gen.yml` and `code-checks.yml`
each **only do work relevant to the PR** — a hardware/icon PR runs the hardware jobs, a
frontend/print-agent PR runs the code jobs, and the heavy jobs of the irrelevant workflow
are **skipped**. `pages.yml` and `hardware-gen.yml` carry real deployment logic (publish to
Pages / push commits back to `main`) — read this before editing either.

**Trigger on everything, skip what's irrelevant (required-check correctness).** Both
verification workflows trigger on **every** `pull_request` and every push to **`main`** —
they are *not* path-filtered at the `on:` level. This is deliberate and is what makes
**branch protection** work: a required status check that never runs stays `Expected` forever
and blocks the PR. Path-filtered triggers would mean a hardware PR never reports the code
checks (and vice-versa), wedging the merge. Instead each workflow starts a tiny `changes`
job (`dorny/paths-filter`) that detects relevant paths; the heavy jobs carry
`if: needs.changes.outputs.<x> == 'true'` and **skip** when nothing relevant changed. We
require only the always-running `gate` job (below) — never the individual jobs — so branch
protection never waits on a check that didn't run; the gate treats a skipped dependency as
OK. The irrelevant workflow therefore clears instantly while the relevant one must genuinely
pass. The expensive work (FreeCAD render, etc.) still only runs when relevant — only the
~2-second `changes`/`gate` jobs run extra.

**One required check per workflow — the `gate` job.** Each workflow ends with a `gate` job
(`if: always()`, `needs:` all the real jobs) that fails only if a dependency *failed or was
cancelled* (skipped/success both pass). Its check name — **`code-checks gate`** and
**`hardware-gen gate`** — is the single stable context to require in branch protection.
**Require exactly those two** (not the individual `js`/`lint`/etc. names): they always
report, collapse the sub-jobs into one green check, and survive adding/removing sub-jobs
without touching branch-protection config.

> **Adding a verification job?** Gate it on `changes` (`needs: changes` +
> `if: needs.changes.outputs.<x> == 'true'`) **and add it to that workflow's `gate`
> `needs:` list.** A job that isn't in the gate's `needs:` is invisible to branch
> protection — effectively optional, even if it fails. This is the one wiring step that's
> easy to forget and silently weakens the gate.

Set required checks via the API (the Settings UI search only lists previously-seen checks):

```bash
gh api repos/gcormier/gfl/branches/main/protection --method PUT --input - <<'EOF'
{ "required_status_checks": { "strict": true,
    "contexts": ["code-checks gate", "hardware-gen gate"] },
  "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null }
EOF
```

**`enforce_admins: false` is load-bearing — don't flip it on.** Required status checks apply
to *every* direct push to `main`, including the `hardware-gen.yml` publish push of generated
SVGs. Classic branch protection has **no per-actor bypass**, so the only way that automated
push gets through is the admin exemption: with "include administrators" OFF, a push
authenticated as a repo admin bypasses the checks. The publish step therefore pushes with a
**PAT owned by the admin** (`PUBLISH_PAT` secret), *not* `GITHUB_TOKEN` (which is not an admin
and gets `GH006`). Turning `enforce_admins` on would re-block the bot. The PAT is a
**fine-grained PAT scoped to this repo**, **Contents: Read and write** (push) + **Actions:
Read and write** (dispatch `pages.yml`); rotate it before its expiry and re-run
`gh secret set PUBLISH_PAT`. (A GitHub App on a *ruleset* bypass list is the no-expiry
alternative we deliberately skipped — overkill for a single-admin repo.)

**PR-verify vs merge-publish.** The `main`-scoped push trigger (alongside `pull_request`) is
the single place the publish path runs: a PR is covered by its `pull_request` event, and the
merge-to-`main` push (which has no associated PR) is where `hardware-gen.yml` commits SVGs +
dispatches Pages. (A code-only push to `main` now also starts `hardware-gen.yml`, but its
`changes` job reports `hw=false`, so `generate` — and thus the publish step — is skipped.)

| Workflow | Triggers | Required check | Purpose |
|---|---|---|---|
| `hardware-gen.yml` | every `pull_request` + push-to-`main` (no path filter; `changes` job gates the work) | **`hardware-gen gate`** | Lint/validate + FreeCAD render of hardware artifacts (commit/deploy on `main` only) |
| `code-checks.yml` | every `pull_request` + push-to-`main` (no path filter; `changes` job gates the work) | **`code-checks gate`** | Verify frontend + print-agent PRs |
| `pages.yml` | push to `main` (deploy only; PRs don't run it) | — | Build catalogs + version, deploy to Pages |

### `pages.yml` — Deploy to GitHub Pages

Publishes the static site (the entire repo root) to GitHub Pages.

- **Triggers**: push to `main` (ignoring `print-agent/**`, which is never deployed) and manual `workflow_dispatch`.
- **Concurrency**: group `pages`, `cancel-in-progress: true` — a newer push supersedes an in-flight deploy.
- **Permissions**: `pages: write`, `id-token: write` (required by `deploy-pages`).
- **Steps**: `checkout` → `setup-uv` → `uv sync` (in `hardware-gen`) → **generate `standards.json` + `custom-icons.json`** → **inject deploy version** → `configure-pages` → `upload-pages-artifact` (path `.`, the whole repo) → `deploy-pages`.
- **Deploy version injection**: computes `YYYY.MM.DD+<short-sha>` from the deployed commit, **writes** the `VERSION` file (untracked — created here), and overwrites the `APP_VERSION` line in `app.js` **in the artifact only** (never committed). This is why the version is never hand-bumped — see mandatory rule #1.
- **Implication**: anything committed to `main` outside `print-agent/` ships to the live site. `standards.json` and `custom-icons.json` are **generated here at deploy time** (not stored in git) from their sources; the committed `hardware-gen/output/*.svg` files are served as-is.

### `code-checks.yml` — Frontend & print-agent PR verification

Lightweight, fast checks for code PRs. **Carries no deploy logic and pushes nothing** —
purely a gate. The heavy jobs only run when code paths changed; on a hardware-only PR they
skip and the `gate` still reports green, so it never gets in `hardware-gen.yml`'s way.

- **Triggers**: every `pull_request` (any branch) **and** push to **`main`** — no `on:`-level
  path filter (so the required `code-checks gate` is always reported). Relevance is decided by
  the `changes` job; the real jobs `if:`-skip when no `*.js`/`*.html`/`*.css`/`print-agent/**`/
  workflow-file changes are present. Push is `main`-scoped as a post-merge backstop.
- **Concurrency**: group `code-checks-${{ github.ref }}`, `cancel-in-progress: true`.
- **`changes`**: `dorny/paths-filter` → `code` output; gates every job below. The `gate` job
  (`if: always()`) is the required check and passes when the others passed or skipped.
- **Jobs** (parallel, no FreeCAD, no heavy deps; skipped unless `changes.code == 'true'`):
  1. **`js`** — `node --check` on every root `*.js`. Parses (doesn't execute) each module,
     catching syntax errors — including the web worker — before they ship. Then runs
     `node --test tests/*.test.js` — unit tests for the pure image-trace pipeline via Node's
     built-in runner (`node:test`/`node:assert`). No build step, no lint config, no test
     framework or dependencies; the repo is intentionally build-free.
  2. **`print-agent`** — `uvx ruff check --select F,B print-agent/agent.py`. Pyflakes +
     bugbear only (undefined names, unused imports, likely bugs) — **not** style/modernization
     (E/UP/I), so it won't retroactively fail the script over intentional compact style. Lint
     only; **no version-bump gate** (a hand-edited version line is a merge surface — same
     reasoning as the web version).
  3. **`no-generated-artifacts`** — fails if `standards.json`, `custom-icons.json`, or
     `VERSION` are tracked in git. They're written at deploy time and `.gitignore`d;
     committing one makes it a merge surface and a stale-data risk.

### `hardware-gen.yml` — Hardware artifact generation & validation

Lints, validates, and (on relevant pushes) regenerates the FreeCAD-derived hardware artifacts, committing the resulting SVGs back to the repo so Pages can serve them.

- **Triggers**: every `pull_request` (any branch) **and** push to **`main`** — no `on:`-level
  path filter (so the required `hardware-gen gate` is always reported); plus `workflow_dispatch`
  with an optional `config_file` input (empty = process all configs). The `changes` job decides
  relevance from `hardware-gen/config/**`, `hardware-gen/freecad_scripts/**`,
  `hardware-gen/pipeline/**`, `hardware-gen/generate_custom_icons.py`, `images/custom/**`,
  `custom-icons.json`, or the workflow file; the heavy jobs `if:`-skip otherwise. Push is
  `main`-scoped as a post-merge backstop.
- **Concurrency**: group `hardware-gen-${{ github.ref }}`, `cancel-in-progress: true` — one run per branch to avoid clobbering the artifact cache; other branches run independently.
- **`changes`**: `dorny/paths-filter` → `hw` output; gates the chain below. The `gate` job
  (`if: always()`, `needs:` lint/dry-run/generate) is the required check.
- **Jobs run sequentially (`needs`)**: `changes` → `lint` → `dry-run` → `generate`. **All three run on relevant PRs too** — the `generate` render verifies the geometry actually builds (a valid-name-but-fails-to-build render fails the PR), made cheap by the warm FreeCAD/Fasteners caches (~30s). On a non-hardware PR they skip entirely. Only the **commit-back + Pages dispatch** inside `generate` is gated to non-PR events (push-to-`main`/`workflow_dispatch`), so PRs render-to-verify but never commit or deploy.

1. **`lint`** (no FreeCAD): `uv sync --dev`, then `ruff check .` and `mypy generate.py pipeline/`. Working dir `hardware-gen`.
2. **`dry-run`** (no FreeCAD): parses/validates YAML via `generate.py --dry-run`, then runs `generate_standards_json.py` and `generate_custom_icons.py` (no `--check`) as a **validation gate** — they parse the source YAML and validate every SVG's metadata, failing CI on malformed input. `--dry-run` also **validates every render's `id` against the committed `pipeline/fastener_types.json` snapshot** (the workbench registry), so a non-existent standard name (e.g. `iso7980`) fails *here*, with no FreeCAD, rather than as an opaque enumeration error mid-render. They no longer diff against a committed JSON for the catalogs (there isn't one — it's generated at deploy time).
3. **`generate`** (requires FreeCAD, `contents: write` + `actions: write`): downloads & extracts the FreeCAD 1.1.1 AppImage to `/opt/freecad` (cached by URL), installs the Fasteners workbench (cached weekly via a `%Y-%U` key). It first **rechecks `pipeline/fastener_types.json` live against the installed workbench** (`dump_fastener_types.py` `mode=check`) so the snapshot can't silently go stale after a FreeCAD/Fasteners upgrade, then runs `generate.py` headless (`QT_QPA_PLATFORM=offscreen`, `FREECADCMD` pointed at the extracted binary). Uploads STEP and SVG artifacts (30-day retention). The final step **commits the regenerated `hardware-gen/output/*.svg` back to the repo** as `github-actions[bot]` with `[skip ci]`, pushes, and — when SVGs changed — **dispatches `pages.yml`** (`gh workflow run`) so the new geometry ships to Pages. **This publish step is gated `if: github.event_name != 'pull_request'`**: on a PR everything above it still runs (render + artifact upload, the verification), but it commits/deploys nothing — the elevated `contents: write` perms are auto-downgraded to read on fork PRs and the step is skipped on all PRs.

**Caching notes**: the FreeCAD AppImage cache key is the download URL — bump `FREECAD_APPIMAGE_URL` to upgrade FreeCAD and the cache invalidates automatically. The Fasteners workbench cache rotates weekly so upstream fixes get picked up without manual cache busting.

**Why the PAT push + explicit `pages.yml` dispatch**: the publish push authenticates with the
admin `PUBLISH_PAT` (so it bypasses branch protection — see above) over an explicit token URL
that overrides the `GITHUB_TOKEN` creds `actions/checkout` persisted. Because it's a **PAT, not
`GITHUB_TOKEN`**, the push is **not** covered by GitHub's recursion guard — so `[skip ci]` on
the commit is *load-bearing*: without it the SVG commit would retrigger `hardware-gen.yml`
(render→commit→render loop). `[skip ci]` also suppresses the push-triggered `pages.yml`, so the
`generate` job explicitly runs `gh workflow run pages.yml --ref main` (only when SVGs actually
changed) to ship them. Net effect on a standard merge: `pages.yml` first deploys the new
`standards.json` (briefly referencing a not-yet-committed SVG), then this dispatch fires a
second deploy ~1–2 min later that includes the SVG — self-healing, no manual deploy needed.

