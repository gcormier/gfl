'use strict';

// ─── JSCad Editor ─────────────────────────────────────────────────────────────
// Isolated module for the custom-image designer on contribute.html. Designs are
// exported as a single-path SVG and submitted to images/custom/ via github-contrib.js.

// ─── Worker Lifecycle ─────────────────────────────────────────────────────────

const WORKER_TIMEOUT_MS = 4000;

function runJscadCode(code) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(assetUrl('jscad-worker.js'));
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Timed out after 4 seconds.'));
    }, WORKER_TIMEOUT_MS);

    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      if (e.data.ok) {
        resolve({ outlines: e.data.outlines, bbox: e.data.bbox });
      } else {
        reject(new Error(e.data.error));
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(e.message || 'Worker error'));
    };
    worker.postMessage({ code });
  });
}

// ─── Preview Canvas ───────────────────────────────────────────────────────────

function renderPreview(canvas, outlines, bbox) {
  const { minX, minY, maxX, maxY } = bbox;
  const geoW = maxX - minX;
  const geoH = maxY - minY;
  const padding = 8;
  const availW = canvas.width  - padding * 2;
  const availH = canvas.height - padding * 2;
  const scale  = Math.min(availW / geoW, availH / geoH);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Checkerboard background so transparent areas are obvious
  const cs = 6;
  for (let r = 0; r * cs < canvas.height; r++) {
    for (let c = 0; c * cs < canvas.width; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f0f0f0' : '#ddd';
      ctx.fillRect(c * cs, r * cs, cs, cs);
    }
  }

  // Centre the geometry
  const offX = padding + (availW - geoW * scale) / 2;
  const offY = padding + (availH - geoH * scale) / 2;

  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(scale, -scale);           // flip Y (JSCad Y-up → canvas Y-down)
  ctx.translate(-minX, -maxY);

  const path = new Path2D();
  for (const outline of outlines) {
    if (outline.length < 2) continue;
    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      path.lineTo(outline[i][0], outline[i][1]);
    }
    path.closePath();
  }
  ctx.fillStyle = '#111';
  ctx.fill(path, 'evenodd');
  ctx.restore();
}

// ─── Editor State ─────────────────────────────────────────────────────────────

let _editorGetValue = null;   // () => string — returns current code
let _editorSetValue = null;   // (string) => void — sets code
let _lastResult = null;       // { outlines, bbox } of most recent successful run
let _runDebounce = null;

const DEFAULT_TEMPLATE = `// JSCad custom-image definition
// Injected namespaces are available: primitives, booleans, transforms, expansions, hulls
// main() must return 2D geometry (geom2)

const { circle, rectangle, polygon } = primitives;
const { subtract, union } = booleans;
const { translate } = transforms;

function main() {
  const head = circle({ radius: 5, segments: 6 });
  const shaft = translate([0, -9], rectangle({ size: [3, 14] }));
  return union(head, shaft);
}
`;

// ─── Run + Preview ────────────────────────────────────────────────────────────

async function _runAndPreview() {
  const code      = _editorGetValue ? _editorGetValue() : '';
  const statusEl  = document.getElementById('jscadStatus');
  const useBtn    = document.getElementById('jscadUseBtn');
  const submitBtn = document.getElementById('jscadSubmitBtn');
  const exportBtn = document.getElementById('jscadExportSvgBtn');
  const canvas    = document.getElementById('jscadPreviewCanvas');

  statusEl.textContent = 'Running…';
  statusEl.className = 'jscad-status';

  try {
    const result = await runJscadCode(code);
    _lastResult = result;
    renderPreview(canvas, result.outlines, result.bbox);
    statusEl.textContent = '✓ OK';
    statusEl.className = 'jscad-status ok';
    if (useBtn)    useBtn.disabled    = false;
    if (submitBtn) submitBtn.disabled = false;
    if (exportBtn) exportBtn.disabled = false;
  } catch (err) {
    _lastResult = null;
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'jscad-status error';
    if (useBtn)    useBtn.disabled    = true;
    if (submitBtn) submitBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
  }
}

function _scheduleRun() {
  clearTimeout(_runDebounce);
  _runDebounce = setTimeout(_runAndPreview, 400);
}

// ─── SVG Export ───────────────────────────────────────────────────────────────

function _outlinesToSvg(outlines, bbox) {
  const { minX, minY, maxX, maxY } = bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  let d = '';
  for (const outline of outlines) {
    if (outline.length < 2) continue;
    // JSCad is Y-up; SVG is Y-down — flip: svg_y = h - (jscad_y - minY)
    d += `M${(outline[0][0] - minX).toFixed(4)},${(h - (outline[0][1] - minY)).toFixed(4)}`;
    for (let i = 1; i < outline.length; i++) {
      d += ` L${(outline[i][0] - minX).toFixed(4)},${(h - (outline[i][1] - minY)).toFixed(4)}`;
    }
    d += ' Z';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(4)} ${h.toFixed(4)}">\n  <path d="${d}" fill="#000000" fill-rule="evenodd"/>\n</svg>\n`;
}

function _exportSvg() {
  if (!_lastResult) return;
  const svg  = _outlinesToSvg(_lastResult.outlines, _lastResult.bbox);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'icon.svg';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── "Use as Icon" ────────────────────────────────────────────────────────────

function _onUseAsIcon() {
  if (!_lastResult) return;
  // setJscadResult is defined in catalog.js
  setJscadResult(_lastResult.outlines, _lastResult.bbox);
  scheduleRender();
  const btn = document.getElementById('jscadUseBtn');
  const orig = btn.textContent;
  btn.textContent = '✓ Applied';
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// ─── Initialisation ───────────────────────────────────────────────────────────

async function initJscadEditor() {
  const wrap    = document.getElementById('jscadEditorWrap');
  const runBtn  = document.getElementById('jscadRunBtn');
  const useBtn  = document.getElementById('jscadUseBtn');
  const canvas  = document.getElementById('jscadPreviewCanvas');

  if (!wrap) return; // section not present in DOM

  // Size the preview canvas
  canvas.width  = 200;
  canvas.height = 200;

  // Always create a working textarea first — guaranteed editable.
  const ta = document.createElement('textarea');
  ta.id = 'jscadTextarea';
  ta.className = 'jscad-textarea-fallback';
  ta.value = DEFAULT_TEMPLATE;
  ta.spellcheck = false;
  ta.addEventListener('input', _scheduleRun);
  wrap.appendChild(ta);
  _editorGetValue = () => ta.value;
  _editorSetValue = (code) => { ta.value = code; };

  // Progressively enhance with CodeMirror 6 if available (replaces the textarea).
  try {
    const [{ EditorView, basicSetup }, { javascript }] = await Promise.all([
      import('https://esm.sh/codemirror@6.0.1'),
      import('https://esm.sh/@codemirror/lang-javascript@6.2.2'),
    ]);

    const view = new EditorView({
      doc: ta.value,
      extensions: [
        basicSetup,
        javascript(),
        EditorView.updateListener.of(update => {
          if (update.docChanged) _scheduleRun();
        }),
      ],
      parent: wrap,
    });

    // CM loaded — swap out textarea
    ta.remove();
    _editorGetValue = () => view.state.doc.toString();
    _editorSetValue = (code) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
    };
  } catch {
    // CodeMirror unavailable — textarea remains active, no action needed.
  }

  runBtn.addEventListener('click', _runAndPreview);
  if (useBtn) useBtn.addEventListener('click', _onUseAsIcon);

  const exportBtn2 = document.getElementById('jscadExportSvgBtn');
  if (exportBtn2) exportBtn2.addEventListener('click', _exportSvg);

  const submitBtn2 = document.getElementById('jscadSubmitBtn');
  submitBtn2.addEventListener('click', () => {
    if (!_lastResult) return;
    const svg = _outlinesToSvg(_lastResult.outlines, _lastResult.bbox);
    openContribModal(svg); // defined in github-contrib.js
  });

  // Run the default template once on load
  _runAndPreview();
}

// Sets the editor to arbitrary code (used by image-trace.js after tracing).
function setEditorCode(code) {
  if (_editorSetValue) _editorSetValue(code);
  _scheduleRun();
}
