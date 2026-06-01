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
  if (_renderMode === 'outline') {
    ctx.strokeStyle = '#111';
    ctx.lineWidth  = _strokeWidth;
    ctx.lineJoin   = 'round';
    ctx.lineCap    = 'round';
    ctx.stroke(path);
  } else {
    ctx.fillStyle = '#111';
    ctx.fill(path, 'evenodd');
  }
  ctx.restore();
}

// ─── Editor State ─────────────────────────────────────────────────────────────

let _editorGetValue = null;   // () => string — returns current code
let _editorSetValue = null;   // (string) => void — sets code
let _lastResult = null;       // { outlines, bbox } of most recent successful run
let _runDebounce = null;
let _renderMode  = 'solid';   // 'solid' | 'outline'
let _strokeWidth = 0.3;
let _programmaticEdit = false; // true while the trace sliders write the editor — suppresses the auto-run

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
  if (_renderMode === 'outline') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(4)} ${h.toFixed(4)}">\n  <path d="${d}" fill="none" stroke="#000000" stroke-width="${_strokeWidth.toFixed(3)}" stroke-linejoin="round" stroke-linecap="round"/>\n</svg>\n`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(4)} ${h.toFixed(4)}">\n  <path d="${d}" fill="#000000" fill-rule="evenodd"/>\n</svg>\n`;
}

function _exportSvg() {
  if (!_lastResult) return;
  let svg = _outlinesToSvg(_lastResult.outlines, _lastResult.bbox);

  // Embed metadata from the inline form fields if provided
  const name     = (document.getElementById('iconMetaName')?.value || '').trim();
  const keywords = (document.getElementById('iconMetaKeywords')?.value || '').trim();
  if (name || keywords) {
    const esc  = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const meta = (name     ? `\n  <title>${esc(name)}</title>`   : '') +
                 (keywords ? `\n  <desc>${esc(keywords)}</desc>` : '');
    svg = svg.replace(/(<svg\b[^>]*>)/, `$1${meta}`);
  }

  const idRaw = (document.getElementById('iconMetaId')?.value || '').trim();
  const id    = idRaw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  const blob  = new Blob([svg], { type: 'image/svg+xml' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = (id || 'icon') + '.svg';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Live preview from image-trace sliders (no editor change) ─────────────────

async function previewJscadCode(code) {
  const canvas   = document.getElementById('jscadPreviewCanvas');
  const statusEl = document.getElementById('jscadStatus');
  if (!canvas || !statusEl) return;
  try {
    const result = await runJscadCode(code);
    _lastResult = result;
    renderPreview(canvas, result.outlines, result.bbox);
    statusEl.textContent = '✓ OK';
    statusEl.className = 'jscad-status ok';
    ['jscadUseBtn', 'jscadSubmitBtn', 'jscadExportSvgBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
  } catch { /* keep existing preview on trace failure */ }
}

// Live-sync from the image-trace sliders. Makes the editor the single source of
// truth — the editor text always reflects what the preview shows — while still
// rendering immediately. The editor write is flagged programmatic so it does not
// kick off a second debounced run on top of the preview we render here.
function setEditorCodeFromTrace(code) {
  _programmaticEdit = true;
  try { if (_editorSetValue) _editorSetValue(code); }
  finally { _programmaticEdit = false; }
  previewJscadCode(code);
}

// Called by image-trace.js after parsing SVG paths directly (no JSCAD round-trip).
function setDirectPreview(outlines, bbox) {
  const canvas   = document.getElementById('jscadPreviewCanvas');
  const statusEl = document.getElementById('jscadStatus');
  _lastResult = { outlines, bbox };
  if (canvas)   renderPreview(canvas, outlines, bbox);
  if (statusEl) { statusEl.textContent = '✓ SVG imported'; statusEl.className = 'jscad-status ok'; }
  ['jscadUseBtn', 'jscadSubmitBtn', 'jscadExportSvgBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
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

  // Size the preview canvas (larger buffer → sharper when CSS stretches it)
  canvas.width  = 400;
  canvas.height = 400;

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
          if (update.docChanged && !_programmaticEdit) _scheduleRun();
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

  // Mode toggle (Solid / Outline) + stroke width slider
  const solidBtn    = document.getElementById('jscadModeSolid');
  const outlineBtn  = document.getElementById('jscadModeOutline');
  const strokeRow   = document.getElementById('jscadStrokeRow');
  const strokeSlider = document.getElementById('jscadStrokeSlider');
  const strokeVal   = document.getElementById('jscadStrokeVal');

  function _setRenderMode(mode) {
    _renderMode = mode;
    solidBtn?.classList.toggle('active', mode === 'solid');
    outlineBtn?.classList.toggle('active', mode === 'outline');
    if (strokeRow) strokeRow.hidden = mode !== 'outline';
    if (_lastResult) renderPreview(canvas, _lastResult.outlines, _lastResult.bbox);
  }

  solidBtn?.addEventListener('click', () => _setRenderMode('solid'));
  outlineBtn?.addEventListener('click', () => _setRenderMode('outline'));
  strokeSlider?.addEventListener('input', () => {
    _strokeWidth = +strokeSlider.value;
    if (strokeVal) strokeVal.textContent = _strokeWidth.toFixed(2);
    if (_lastResult) renderPreview(canvas, _lastResult.outlines, _lastResult.bbox);
  });

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
