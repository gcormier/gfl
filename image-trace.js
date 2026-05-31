'use strict';

// ─── RDP Simplification ───────────────────────────────────────────────────────

function _ptLineDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = _ptLineDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > eps) {
    return [
      ..._rdp(pts.slice(0, maxI + 1), eps).slice(0, -1),
      ..._rdp(pts.slice(maxI), eps),
    ];
  }
  return [pts[0], pts[pts.length - 1]];
}

// ─── SVG Path Parsing ─────────────────────────────────────────────────────────

function _bezierPts(x0, y0, x1, y1, x2, y2, x3, y3, n = 8) {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      u*u*u*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3,
      u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3,
    ]);
  }
  return pts;
}

// Parse an SVG path `d` string into one or more subpath point-lists.
// Each M/m command starts a new subpath, so an outer shape and its holes
// (emitted by imagetracer as `M…Z M…Z` within a single path) become separate polygons.
function _pathDToSubpaths(d) {
  const tokens = d.match(/[MmLlCcQqZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const subpaths = [];
  let pts = null;
  let cx = 0, cy = 0, sx = 0, sy = 0, cmd = 'M';
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const startSub = () => { pts = []; subpaths.push(pts); };

  while (i < tokens.length) {
    const tok = tokens[i];
    if (/[MmLlCcQqZz]/.test(tok)) { cmd = tok; i++; continue; }

    if      (cmd === 'M') { cx=num(); cy=num(); sx=cx; sy=cy; startSub(); pts.push([cx,cy]); cmd='L'; continue; }
    else if (cmd === 'm') { cx+=num(); cy+=num(); sx=cx; sy=cy; startSub(); pts.push([cx,cy]); cmd='l'; continue; }
    else if (!pts) { startSub(); }

    if      (cmd === 'L') { cx=num(); cy=num(); pts.push([cx,cy]); }
    else if (cmd === 'l') { cx+=num(); cy+=num(); pts.push([cx,cy]); }
    else if (cmd === 'C') {
      const x1=num(),y1=num(),x2=num(),y2=num(),x3=num(),y3=num();
      _bezierPts(cx,cy,x1,y1,x2,y2,x3,y3).forEach(p=>pts.push(p));
      cx=x3; cy=y3;
    }
    else if (cmd === 'c') {
      const x1=cx+num(),y1=cy+num(),x2=cx+num(),y2=cy+num(),dx=num(),dy=num();
      _bezierPts(cx,cy,x1,y1,x2,y2,cx+dx,cy+dy).forEach(p=>pts.push(p));
      cx+=dx; cy+=dy;
    }
    else if (cmd === 'Q') {
      const qx1=num(),qy1=num(),qx2=num(),qy2=num();
      _bezierPts(cx,cy, cx+(2/3)*(qx1-cx), cy+(2/3)*(qy1-cy),
        qx2+(2/3)*(qx1-qx2), qy2+(2/3)*(qy1-qy2), qx2, qy2).forEach(p=>pts.push(p));
      cx=qx2; cy=qy2;
    }
    else if (cmd === 'q') {
      const ax=cx+num(),ay=cy+num(),bx=cx+num(),by=cy+num();
      _bezierPts(cx,cy, cx+(2/3)*(ax-cx), cy+(2/3)*(ay-cy),
        bx+(2/3)*(ax-bx), by+(2/3)*(ay-by), bx, by).forEach(p=>pts.push(p));
      cx=bx; cy=by;
    }
    else if (cmd === 'Z' || cmd === 'z') { cx=sx; cy=sy; }
    else { i++; }
  }
  return subpaths;
}

// Parse dark-filled paths from imagetracer SVG output.
// imagetracer emits flat `<path fill="rgb(...)" ... d="..."/>` elements (no <g> groups).
function _parseDarkPaths(svgStr) {
  const paths = [];
  const pathRe = /<path\b[^>]*?\bfill="([^"]+)"[^>]*?\bd="([^"]+)"[^>]*>/g;
  let pm;
  while ((pm = pathRe.exec(svgStr)) !== null) {
    const rgb = pm[1].match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgb && +rgb[1] > 200 && +rgb[2] > 200 && +rgb[3] > 200) continue; // skip white/near-white
    for (const pts of _pathDToSubpaths(pm[2])) {
      if (pts.length >= 3) paths.push(pts);
    }
  }
  return paths;
}

// ─── Polygon area (shoelace) ──────────────────────────────────────────────────

function _polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(a) * 0.5;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _itOrigCanvas = null;
let _itSelection  = null;
let _itDragging   = false;
let _itDragStart  = null;
let _itLastCode   = null;
let _itTraceTimer = null;
let _galleryMeta  = null;  // {id, name, keywords} — set when an SVG with metadata is imported

function getGalleryMeta() { return _galleryMeta; }

// ─── Core: image region → JSCAD code ─────────────────────────────────────────

function _traceRegion(threshold, epsilon) {
  if (!_itOrigCanvas) return null;
  if (typeof ImageTracer === 'undefined') return null;

  const sel = _itSelection;
  const ix = sel ? Math.round(sel.x) : 0;
  const iy = sel ? Math.round(sel.y) : 0;
  const iw = sel ? Math.round(sel.w) : _itOrigCanvas.width;
  const ih = sel ? Math.round(sel.h) : _itOrigCanvas.height;
  if (iw < 4 || ih < 4) return null;

  // Extract region and apply grayscale threshold
  const ctx  = _itOrigCanvas.getContext('2d');
  const imgd = ctx.getImageData(ix, iy, iw, ih);
  const d    = imgd.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    const v = gray < threshold ? 0 : 255;
    d[i] = d[i+1] = d[i+2] = v;
    d[i+3] = 255;
  }

  // imagetracer: raster → SVG paths
  const svgStr = ImageTracer.imagedataToSVG(imgd, {
    numberofcolors: 2,
    colorsampling:  2,      // sample palette from actual image data (not a fixed random palette)
    mincolorratio:  0,
    pathomit:       4,      // min path nodes to keep — lowered from 8 to preserve small detail rings
    ltres:          0.5,
    qtres:          0.5,
    strokewidth:    0,
    linefilter:     false,
    scale:          1,
    roundcoords:    2,
    viewbox:        false,
    desc:           false,
  });

  console.log('[image-trace] svgStr length=', svgStr.length, 'preview=', svgStr.slice(0, 400));

  let paths = _parseDarkPaths(svgStr);
  console.log('[image-trace] parseDarkPaths returned', paths.length, 'paths');

  // Drop tiny paths (noise artifacts) — threshold lowered to preserve inner ring details
  const minArea = iw * ih * 0.0002;
  const areas = paths.map(p => _polyArea(p));
  console.log('[image-trace] path areas (top 10):', [...areas].sort((a,b)=>b-a).slice(0,10).map(a=>a.toFixed(1)));
  const beforeFilter = paths.length;
  paths = paths.filter((p, i) => areas[i] > minArea);
  console.log('[image-trace] after area filter (minArea=', minArea.toFixed(1), '):', paths.length, 'of', beforeFilter, 'remain');
  if (!paths.length) return null;

  // RDP simplification
  if (epsilon > 0) paths = paths.map(p => _rdp(p, epsilon));
  paths = paths.filter(p => p.length >= 3);
  if (!paths.length) return null;

  // Sort largest first (outer shape first, holes after)
  paths.sort((a, b) => _polyArea(b) - _polyArea(a));

  // Normalize: center at origin, scale largest dimension to 10 units, flip Y
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const p of paths) for (const [x, y] of p) {
    if (x < minX) minX=x; if (x > maxX) maxX=x;
    if (y < minY) minY=y; if (y > maxY) maxY=y;
  }
  const span  = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = 10 / span;
  const midX  = (minX + maxX) / 2;
  const midY  = (minY + maxY) / 2;

  const norm = paths.map(path =>
    path.map(([x, y]) => [
      +((x - midX) * scale).toFixed(3),
      +((midY - y) * scale).toFixed(3),   // flip Y: canvas Y-down → JSCAD Y-up
    ])
  );

  return _toJscad(norm);
}

function _toJscad(paths) {
  const fmt = pts =>
    '[\n    ' + pts.map(([x, y]) => `[${x}, ${y}]`).join(', ') + '\n  ]';

  const lines = ['// Auto-traced from image — review and adjust as needed'];

  if (paths.length === 1) {
    lines.push(
      'const { polygon } = primitives;', '',
      'function main() {',
      `  return polygon({ points: ${fmt(paths[0])} });`,
      '}'
    );
  } else {
    lines.push(
      'const { polygon } = primitives;',
      'const { subtract } = booleans;', '',
      'function main() {',
      `  const outer = polygon({ points: ${fmt(paths[0])} });`
    );
    for (let i = 1; i < paths.length; i++) {
      lines.push(`  const hole${i} = polygon({ points: ${fmt(paths[i])} });`);
    }
    const holeNames = paths.slice(1).map((_, i) => `hole${i+1}`).join(', ');
    lines.push(`  return subtract(outer, ${holeNames});`, '}');
  }
  return lines.join('\n');
}

// ─── Display canvas helpers ───────────────────────────────────────────────────

function _toImgCoords(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(_itOrigCanvas.width,  (e.clientX - r.left) * (_itOrigCanvas.width  / r.width))),
    Math.max(0, Math.min(_itOrigCanvas.height, (e.clientY - r.top)  * (_itOrigCanvas.height / r.height))),
  ];
}

function _redrawDisplay() {
  const cv = document.getElementById('itDisplayCanvas');
  if (!cv || !_itOrigCanvas) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(_itOrigCanvas, 0, 0, cv.width, cv.height);

  if (!_itSelection) return;
  const sx = cv.width  / _itOrigCanvas.width;
  const sy = cv.height / _itOrigCanvas.height;
  const { x, y, w, h } = _itSelection;
  const [dx, dy, dw, dh] = [x*sx, y*sy, w*sx, h*sy];

  // Dim outside selection
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0,    0,       cv.width, dy);
  ctx.fillRect(0,    dy+dh,   cv.width, cv.height-dy-dh);
  ctx.fillRect(0,    dy,      dx,       dh);
  ctx.fillRect(dx+dw,dy,      cv.width-dx-dw, dh);

  // Selection border
  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth   = 2;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(dx, dy, dw, dh);
  ctx.restore();
}

// ─── Trace + update status (debounced) ───────────────────────────────────────

function _scheduleTrace() {
  clearTimeout(_itTraceTimer);
  _itTraceTimer = setTimeout(() => {
    const threshold = +document.getElementById('itThresholdSlider').value;
    const epsilon   = +document.getElementById('itEpsilonSlider').value;
    document.getElementById('itThresholdVal').textContent = threshold;
    document.getElementById('itEpsilonVal').textContent   = epsilon;

    if (typeof ImageTracer === 'undefined') {
      _setTraceStatus('Image tracer library not loaded', 'error');
      return;
    }

    console.log('[image-trace] tracing with threshold=', threshold, 'epsilon=', epsilon, 'origCanvas=', _itOrigCanvas?.width, 'x', _itOrigCanvas?.height);
    const code = _traceRegion(threshold, epsilon);
    console.log('[image-trace] trace result:', code ? 'got code (' + code.length + ' chars)' : 'null');
    const btn  = document.getElementById('itInsertBtn');

    if (code) {
      _itLastCode  = code;
      btn.disabled = false;
      const nPaths = (code.match(/polygon\(/g) || []).length;
      const nPts   = (code.match(/\[-?\d/g) || []).length;
      _setTraceStatus(`✓ ${nPts} vertices · ${nPaths} path${nPaths !== 1 ? 's' : ''}`, 'ok');
      previewJscadCode(code); // live-update JSCAD preview canvas
    } else {
      _itLastCode  = null;
      btn.disabled = true;
      _setTraceStatus('No paths found — try adjusting threshold', 'error');
    }
  }, 250);
}

function _setTraceStatus(msg, type) {
  const el = document.getElementById('itTraceStatus');
  el.textContent = msg;
  el.className   = 'jscad-status' + (type ? ' ' + type : '');
}

// ─── Image loading ────────────────────────────────────────────────────────────

function _loadImageElement(img) {
  console.log('[image-trace] loadImageElement naturalWidth=', img.naturalWidth, 'naturalHeight=', img.naturalHeight);
  const MAX = 1200;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w*s); h = Math.round(h*s); }

  _itOrigCanvas = document.createElement('canvas');
  _itOrigCanvas.width = w; _itOrigCanvas.height = h;
  const _ictx = _itOrigCanvas.getContext('2d');
  _ictx.fillStyle = '#ffffff';  // transparent PNGs: fill white so alpha=0 → white, not black
  _ictx.fillRect(0, 0, w, h);
  _ictx.drawImage(img, 0, 0, w, h);
  _itSelection = null;

  // Size display canvas (max 560px wide, preserve aspect ratio)
  const cv = document.getElementById('itDisplayCanvas');
  const dw = Math.min(w, 560);
  cv.width  = dw;
  cv.height = Math.round(dw * (h / w));

  document.getElementById('itDropZone').hidden  = true;
  document.getElementById('itImageArea').hidden = false;

  _redrawDisplay();
  _scheduleTrace();
}

// ─── Direct SVG import (bypasses rasterise→trace round-trip) ─────────────────
// Parses <path d="…"> elements from raw SVG text, normalises to JSCAD coordinate
// space (centred, 10-unit bounding box, Y flipped), and hands the outlines
// straight to setDirectPreview() in jscad-editor.js.  Returns the path count on
// success or 0 if no parseable paths were found.

function _parseSvgAndPreview(text) {
  const pathRe = /<path\b[^>]*?\bd="([^"]+)"/g;
  let pm;
  const rawPaths = [];
  while ((pm = pathRe.exec(text)) !== null) {
    for (const pts of _pathDToSubpaths(pm[1])) {
      if (pts.length >= 3) rawPaths.push(pts);
    }
  }
  if (!rawPaths.length) return 0;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const path of rawPaths) {
    for (const [x, y] of path) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }

  const span  = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = 10 / span;
  const midX  = (minX + maxX) / 2;
  const midY  = (minY + maxY) / 2;

  const outlines = rawPaths.map(path =>
    path.map(([x, y]) => [
      +((x - midX) * scale).toFixed(4),
      +((midY - y) * scale).toFixed(4),  // flip Y: SVG Y-down → JSCAD Y-up
    ])
  );

  const hw = (maxX - minX) * scale / 2;
  const hh = (maxY - minY) * scale / 2;
  setDirectPreview(outlines, { minX: -hw, maxX: hw, minY: -hh, maxY: hh });
  return rawPaths.length;
}

function _showSvgImportedArea(msg) {
  document.getElementById('itDropZone').hidden  = true;
  document.getElementById('itImageArea').hidden = true;
  const area = document.getElementById('itSvgImportedArea');
  if (area) {
    area.hidden = false;
    const el = document.getElementById('itSvgImportedMsg');
    if (el) el.textContent = msg;
  }
}

function _loadFile(file) {
  if (!file) return;

  if (file.type === 'image/svg+xml' || file.name?.toLowerCase().endsWith('.svg')) {
    const reader = new FileReader();
    reader.onload = e => {
      const text  = e.target.result;
      const count = _parseSvgAndPreview(text);
      if (count) {
        const name = (text.match(/<title>([^<]*)<\/title>/)?.[1] || '').trim();
        const kw   = (text.match(/<desc>([^<]*)<\/desc>/)?.[1] || '').trim();
        const id   = (file.name || '').replace(/\.svg$/i, '');
        if (name || kw) _galleryMeta = { id, name, keywords: kw };
        _showSvgImportedArea(`✓ ${count} path${count !== 1 ? 's' : ''} imported${name ? ` · ${name}` : ''}`);
      } else {
        _setTraceStatus('No paths found in SVG — try the image trace instead', 'error');
      }
    };
    reader.readAsText(file);
    return;
  }

  if (!file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload  = () => { _loadImageElement(img); URL.revokeObjectURL(url); };
  img.onerror = () =>   URL.revokeObjectURL(url);
  img.src = url;
}

// ─── Public init ─────────────────────────────────────────────────────────────

function initImageTracer() {
  const dz  = document.getElementById('itDropZone');
  const fin = document.getElementById('itFileInput');
  const cv  = document.getElementById('itDisplayCanvas');

  // Drop zone: drag & drop
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('it-drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('it-drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('it-drag-over');
    _loadFile(e.dataTransfer.files[0]);
  });

  // Drop zone: click to browse
  dz.addEventListener('click', () => fin.click());
  fin.addEventListener('change', e => { if (e.target.files[0]) _loadFile(e.target.files[0]); });

  // Global paste (Ctrl+V / ⌘V) — capture phase so CodeMirror can't swallow it first
  document.addEventListener('paste', e => {
    const items = [...e.clipboardData.items];
    // SVG on clipboard (e.g. copy from Inkscape/Illustrator)
    const svgItem = items.find(it => it.type === 'image/svg+xml');
    if (svgItem) {
      e.preventDefault();
      e.stopPropagation();
      svgItem.getAsString(text => {
        _galleryMeta = null;
        const count = _parseSvgAndPreview(text);
        if (count) {
          const name = (text.match(/<title>([^<]*)<\/title>/)?.[1] || '').trim();
          _showSvgImportedArea(`✓ ${count} path${count !== 1 ? 's' : ''} imported${name ? ` · ${name}` : ''}`);
        } else {
          _setTraceStatus('No paths found in pasted SVG', 'error');
        }
      });
      return;
    }
    const imgItem = items.find(it => it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      e.stopPropagation();
      _galleryMeta = null;
      _loadFile(imgItem.getAsFile());
    }
  }, { capture: true });

  // Region selection drag on display canvas
  cv.addEventListener('mousedown', e => {
    if (!_itOrigCanvas) return;
    _itDragging  = true;
    _itDragStart = _toImgCoords(cv, e);
    _itSelection = null;
    _redrawDisplay();
  });
  cv.addEventListener('mousemove', e => {
    if (!_itDragging) return;
    const [ex, ey] = _toImgCoords(cv, e);
    const x = Math.min(_itDragStart[0], ex),  y = Math.min(_itDragStart[1], ey);
    const w = Math.abs(ex - _itDragStart[0]), h = Math.abs(ey - _itDragStart[1]);
    if (w > 4 && h > 4) _itSelection = { x, y, w, h };
    _redrawDisplay();
  });
  cv.addEventListener('mouseup', () => {
    _itDragging = false;
    if (_itSelection?.w > 4) _scheduleTrace();
  });

  // Sliders
  ['itThresholdSlider', 'itEpsilonSlider'].forEach(id => {
    document.getElementById(id).addEventListener('input', _scheduleTrace);
  });

  // Insert into editor
  document.getElementById('itInsertBtn').addEventListener('click', () => {
    if (!_itLastCode) return;
    setEditorCode(_itLastCode);
    document.getElementById('jscadSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Clear raster image
  document.getElementById('itClearBtn').addEventListener('click', () => {
    _itOrigCanvas = _itSelection = _itLastCode = _galleryMeta = null;
    document.getElementById('itDropZone').hidden  = false;
    document.getElementById('itImageArea').hidden = true;
    document.getElementById('itInsertBtn').disabled = true;
    _setTraceStatus('', '');
  });

  // Clear direct SVG import
  document.getElementById('itClearSvgBtn')?.addEventListener('click', () => {
    _galleryMeta = null;
    document.getElementById('itSvgImportedArea').hidden = true;
    document.getElementById('itDropZone').hidden = false;
  });
}
