# Agent Instructions & Architecture

## Application Summary

**Gridfinity Label Generator** is a browser-based tool for designing and printing custom labels for Gridfinity storage bins. Users compose labels with text, icons, and parametric JSCAD geometry outlines, then print them directly to a Brother PT-P710BT label printer.

**Technical Stack:**
- **Frontend**: Pure client-side JavaScript (no build step), hosted on GitHub Pages. Core modules handle rendering (`renderer.js`), JSCAD geometry evaluation in a Web Worker (`jscad-worker.js`), icon/standard catalog browsing (`catalog.js`), and the GitHub contribution flow (`github-contrib.js`).
- **Print Agent**: A local Python HTTP server (`print-agent/agent.py`) running on `localhost:9100` via `uv run`. It receives base64 PNG label images from the browser and converts them to Brother raster protocol data for USB printing.
- **Standards**: Community-contributed JSCAD shape definitions (`standards-jscad/`) and a `standards.json` catalog define the available parametric label standards. `standards.json` is a **generated file** — source of truth is `hardware-gen/config/standards_meta.yaml`.

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
- **`jscad-editor.js`**: The Design panel module. Manages the in-browser JSCAD code editor, the standard registry (`registerJscadStandard`), spawning `jscad-worker.js` to evaluate code, and displaying the resulting geometry preview. Communicates with the rest of the app only via `setJscadResult()` and `scheduleRender()`.
- **`jscad-worker.js`**: A Web Worker that safely evaluates user-supplied JSCAD code in a sandboxed context (no DOM access). Imports the `@jscad/modeling` library via `importScripts`, runs the code, and posts back the resulting geometry or an error.
- **`image-trace.js`**: Converts a raster image (bitmap) into a set of vector outlines suitable for use as a JSCAD standard. Implements Ramer–Douglas–Peucker simplification, SVG path parsing, and canvas-based pixel tracing.
- **`github-contrib.js`**: Handles the "Contribute" flow. Builds a GitHub "create new file" URL pre-filled with the standard contents, then opens it in a new tab — no OAuth or backend required; GitHub's own UI handles the fork/PR flow.

## Hardware Standards Workflow

`standards.json` (root) is **generated** — never edit it by hand.

**Source of truth**: `hardware-gen/config/standards_meta.yaml`

To add or modify a standard:
1. Edit `hardware-gen/config/standards_meta.yaml`
2. Run `python hardware-gen/generate_standards_json.py` from the repo root
3. Commit both the YAML and the updated `standards.json`

CI (`hardware-gen.yml`) runs `generate_standards_json.py --check` on every push that touches `hardware-gen/config/` and will fail if `standards.json` is out of sync.

> **Version bump required**: `standards.json` is a frontend JSON file — any regeneration that changes its content must also increment `VERSION` and `APP_VERSION` per the mandatory atomic rules above.

---

### standards-jscad/

Each file in this directory registers one JSCAD standard shape by calling `window.registerJscadStandard(id, code)`. Current standards:

