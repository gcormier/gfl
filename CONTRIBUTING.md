# Contributing a Standard

The GFL standards catalog ships with a small set of sample fastener icons
defined in **[JSCad](https://openjscad.xyz/)** — a JavaScript-based parametric
2D/3D CAD library. Every icon in `standards-jscad/*.js` is a tiny program that
returns a 2D outline; the app renders it onto the label canvas at print time.

The easiest way to contribute a new standard is **directly in the browser**, no
local tooling required.

## In-browser flow (recommended)

1. Open the app at <https://gcormier.github.io/gfl/>.
2. In the **Design** panel, edit the JSCad code in the editor. Click **▶ Run**
   to see the preview update.
3. When you're happy with the icon, click **Submit Standard…**
4. Enter an ID for the standard (lowercase letters, digits, dashes — this
   becomes the filename, e.g. `iso4762` → `standards-jscad/iso4762.js`).
5. Click **Open on GitHub →**. A new tab opens on github.com with the file
   contents pre-filled. GitHub will offer to fork the repo, then walk you
   through committing and opening a pull request.

No tokens, no OAuth, no local clone needed.

## File format

Each standard is a single JS file that calls `registerJscadStandard(id, code)`
with a template-literal body:

```js
registerJscadStandard('iso4762', `// ISO 4762 — Hexagon Socket Head Cap Screw
const { circle, rectangle, polygon } = primitives;
const { subtract, union } = booleans;
const { translate } = transforms;

function main() {
  // ... build geometry, return a JSCad 2D shape
}
`);
```

The inner code runs inside a sandboxed Web Worker with the
[`@jscad/modeling`](https://www.npmjs.com/package/@jscad/modeling) API exposed
as globals: `primitives`, `booleans`, `transforms`, `extrusions`, etc. Your
`main()` must return a 2D geometry (or an array of them).

Look at the existing samples in [`standards-jscad/`](standards-jscad/) for
working examples:

| File | Standard |
|------|----------|
| `iso4762.js` | Socket head cap screw |
| `iso10642.js` | Flat (countersunk) head screw |
| `iso7380.js`  | Button head screw |
| `iso4032.js`  | Hex nut |
| `iso10511.js` | Nylon-insert lock nut |
| `iso7089.js`  | Plain washer |

## Local editing (optional)

If you'd rather work locally:

```bash
git clone https://github.com/gcormier/gfl.git
cd gfl
# Open index.html via any static file server, e.g.:
python -m http.server 8000
# Then visit http://localhost:8000/
```

Edit a file under `standards-jscad/`, reload the page, and your changes show up
in the editor. Commit and open a PR the usual way.

## Naming

Prefer the **ISO** number when both ISO and DIN equivalents exist (ISO is
international). Filenames use lowercase with no separators, e.g. `iso4762.js`,
not `ISO-4762.js`.
