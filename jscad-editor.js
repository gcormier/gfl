'use strict';

// ─── JSCad Editor ─────────────────────────────────────────────────────────────
// Isolated module for the Design panel. Only touches the main app via:
//   - setJscadResult(outlines, bbox) — sets state in catalog.js
//   - scheduleRender() — triggers label canvas redraw
// All editor HTML lives in #jscadSection and can be relocated independently.

// ─── Standard Registry ────────────────────────────────────────────────────────
// standards-jscad/*.js files call window.registerJscadStandard() to register.

const _jscadRegistry = new Map(); // id → { code: string }
const _jscadPending  = new Map(); // id → { resolve, reject }[]

window.registerJscadStandard = function (id, code) {
  _jscadRegistry.set(id, { code });
  if (_jscadPending.has(id)) {
    _jscadPending.get(id).forEach(({ resolve }) => resolve(code));
    _jscadPending.delete(id);
  }
};

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
let _currentStandardId = null; // id if editor is showing a known standard

const DEFAULT_TEMPLATE = `// JSCad standard definition
// Inject namespaces are available: primitives, booleans, transforms, expansions, hulls
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

// ─── Load a Known Standard into the Editor ───────────────────────────────────

function _updateSubmitLabel() {
  const btn = document.getElementById('jscadSubmitBtn');
  if (!btn) return;
  btn.textContent = _currentStandardId ? 'Modify Standard…' : 'Submit New Standard…';
}

async function loadJscadStandard(id) {
  _currentStandardId = id;
  _updateSubmitLabel();

  // Fetch the source text for the editor display
  let code = null;
  const url = assetUrl('standards-jscad/' + id + '.js');

  try {
    const res = await fetch(url);
    if (res.ok) {
      const raw = await res.text();
      // Strip the registerJscadStandard wrapper — expose just the inner body
      // for editing. The file format wraps code in registerJscadStandard(id, `...`).
      const inner = raw.match(/registerJscadStandard\(\s*['"][^'"]+['"]\s*,\s*`([\s\S]*)`\s*\)/);
      code = inner ? inner[1].trim() : raw;
    }
  } catch { /* fall through to template */ }

  if (!code) code = DEFAULT_TEMPLATE;

  if (_editorSetValue) _editorSetValue(code);

  // Also inject the <script> so the registry gets the factory for catalog rendering
  return new Promise((resolve, reject) => {
    if (_jscadRegistry.has(id)) { resolve(_jscadRegistry.get(id).code); return; }

    const callbacks = _jscadPending.get(id) || [];
    callbacks.push({ resolve, reject });
    _jscadPending.set(id, callbacks);

    if (!document.querySelector(`script[data-jscad="${id}"]`)) {
      const s = document.createElement('script');
      s.src = url;
      s.dataset.jscad = id;
      s.onerror = () => reject(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    }

    setTimeout(() => {
      if (_jscadPending.has(id)) {
        _jscadPending.get(id).forEach(({ reject: r }) => r(new Error('Timeout loading ' + id)));
        _jscadPending.delete(id);
      }
    }, 8000);
  });
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
  a.download = (_currentStandardId || 'standard') + '.svg';
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
    const code = _editorGetValue ? _editorGetValue() : '';
    console.log('[jscad-editor] submit clicked, _currentStandardId=', _currentStandardId, 'isExisting=', !!_currentStandardId, 'codeLen=', code.length);
    openContribModal(_currentStandardId, code, !!_currentStandardId);
  });

  // Run the default template once on load
  _runAndPreview();
}

// Called by catalog.js when a standard with a jscad definition is selected.
function loadStandardIntoEditor(id) {
  loadJscadStandard(id);
}

function clearEditorStandard() {
  _currentStandardId = null;
  _updateSubmitLabel();
}

// Sets the editor to arbitrary code (used by image-trace.js after tracing).
function setEditorCode(code) {
  if (_editorSetValue) _editorSetValue(code);
  clearEditorStandard();
  _scheduleRun();
}

// Resets the editor to the blank template (used by the contribute page "New standard" card).
function resetEditorToTemplate() {
  if (_editorSetValue) _editorSetValue(DEFAULT_TEMPLATE);
  clearEditorStandard();
  _runAndPreview();
}

// Fetches and renders a JSCAD standard into an arbitrary canvas element.
// Used by the standards browser on contribute.html for preview thumbnails.
async function renderStandardIntoCanvas(id, canvas) {
  let code = _jscadRegistry.has(id) ? _jscadRegistry.get(id).code : null;
  if (!code) {
    const url = assetUrl('standards-jscad/' + id + '.js');
    try {
      const res = await fetch(url);
      if (res.ok) {
        const raw   = await res.text();
        const inner = raw.match(/registerJscadStandard\(\s*['"][^'"]+['"]\s*,\s*`([\s\S]*)`\s*\)/);
        code = inner ? inner[1].trim() : null;
      }
    } catch { /* ignore */ }
  }
  if (!code) return;
  try {
    const result = await runJscadCode(code);
    renderPreview(canvas, result.outlines, result.bbox);
  } catch { /* ignore */ }
}
