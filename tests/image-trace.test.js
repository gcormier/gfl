'use strict';

// Unit tests for the pure (DOM-free) image-trace pipeline.
//
// Run: `node --test tests/`  (Node's built-in runner — no deps, no build step,
// matching the repo's build-free philosophy). These exercise everything from SVG
// path parsing through even-odd geometry assembly, WITHOUT the browser canvas or
// the imagetracer library: _svgPathsToJscad() takes an imagetracer-style SVG
// string, so we can feed hand-written fixtures and assert the JSCAD that results.
//
// The headline case is the wire ferrule: a silhouette with concentric mouth
// rings. The old `subtract(largest, ...everythingElse)` assembly erased those
// inner rings; the even-odd model must keep every one. See PR #23.

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const it = require('../image-trace.js');

// ─── Fixture helpers ──────────────────────────────────────────────────────────

// An axis-aligned square as an SVG path `d` string, centred at (cx,cy), side 2r.
const sqD = (cx, cy, r) =>
  `M${cx - r} ${cy - r} L${cx + r} ${cy - r} L${cx + r} ${cy + r} L${cx - r} ${cy + r} Z`;

// One imagetracer-style <path> element (fill BEFORE d, as imagetracer emits and
// as _parseDarkPaths's regex requires).
const pathEl = (fill, d) => `<path fill="${fill}" stroke="none" d="${d}"/>`;

const BLACK = 'rgb(0,0,0)';
const WHITE = 'rgb(255,255,255)';

// A ferrule-ish drawing: white background, outer silhouette, two concentric
// mouth rings (each ring = an outer + an inner contour), plus a speck of noise.
// Areas (side²) chosen so every real feature clears minArea at iw·ih = 200² but
// the 2×2 speck does not. Concentric → all share centre (100,100), so depth is
// decided purely by enclosed area.
function ferruleSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg">
    ${pathEl(WHITE, sqD(100, 100, 95))}   <!-- background: must be skipped -->
    ${pathEl(BLACK, sqD(100, 100, 80))}   <!-- silhouette   area 25600 depth0 solid -->
    ${pathEl(BLACK, sqD(100, 100, 40))}   <!-- ringA outer  area  6400 depth1 hole  -->
    ${pathEl(BLACK, sqD(100, 100, 30))}   <!-- ringA inner  area  3600 depth2 solid -->
    ${pathEl(BLACK, sqD(100, 100, 15))}   <!-- ringB outer  area   900 depth3 hole  -->
    ${pathEl(BLACK, sqD(100, 100, 8))}    <!-- ringB inner  area   256 depth4 solid -->
    ${pathEl(BLACK, sqD(180, 180, 1))}    <!-- speck        area     4 (noise)      -->
  </svg>`;
}

const countPolys = code => (code.match(/polygon\(/g) || []).length;
const isValidJs  = code => { try { new Function(code); return true; } catch { return false; } };

// ─── _pathDToSubpaths ─────────────────────────────────────────────────────────

test('_pathDToSubpaths: a single closed square yields one 4-point subpath', () => {
  const subs = it._pathDToSubpaths('M0 0 L10 0 L10 10 L0 10 Z');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].length, 4);
  assert.deepEqual(subs[0][0], [0, 0]);
});

test('_pathDToSubpaths: each M starts a new subpath (outer + hole stay separate)', () => {
  const subs = it._pathDToSubpaths('M0 0 L10 0 L10 10 Z M2 2 L8 2 L8 8 Z');
  assert.equal(subs.length, 2);
  assert.deepEqual(subs[1][0], [2, 2]);
});

test('_pathDToSubpaths: relative moves accumulate from the current point', () => {
  const subs = it._pathDToSubpaths('M5 5 l5 0 l0 5 l-5 0 z');
  assert.deepEqual(subs[0][0], [5, 5]);
  assert.deepEqual(subs[0][1], [10, 5]);
  assert.deepEqual(subs[0][2], [10, 10]);
});

// ─── Geometry helpers ─────────────────────────────────────────────────────────

test('_polyArea: shoelace area of the unit square is 1 regardless of winding', () => {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.equal(it._polyArea(sq), 1);
  assert.equal(it._polyArea([...sq].reverse()), 1); // |area|, winding-independent
});

test('_polyCentroid: centre of the unit square is (0.5, 0.5)', () => {
  assert.deepEqual(it._polyCentroid([[0, 0], [1, 0], [1, 1], [0, 1]]), [0.5, 0.5]);
});

test('_pointInPoly: ray casting classifies inside vs outside', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(it._pointInPoly([5, 5], sq), true);
  assert.equal(it._pointInPoly([15, 5], sq), false);
});

// ─── _parseDarkPaths ──────────────────────────────────────────────────────────

test('_parseDarkPaths: keeps dark contours and skips near-white ones', () => {
  const svg = pathEl(WHITE, sqD(50, 50, 40)) + pathEl(BLACK, sqD(50, 50, 20));
  const paths = it._parseDarkPaths(svg);
  assert.equal(paths.length, 1, 'only the black path survives');
  assert.equal(paths[0].length, 4);
});

// ─── _toJscad: even-odd nesting ───────────────────────────────────────────────

const sqPts = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];

test('_toJscad: a lone contour becomes a single polygon (no booleans)', () => {
  const code = it._toJscad([sqPts(0, 0, 5)]);
  assert.match(code, /return polygon\(/);
  assert.doesNotMatch(code, /subtract|union/);
  assert.ok(isValidJs(code));
});

test('_toJscad: outer + one centred contour is a simple subtract (washer)', () => {
  const code = it._toJscad([sqPts(0, 0, 10), sqPts(0, 0, 4)]);
  assert.match(code, /return subtract\(solid0, hole0\);/);
  assert.ok(isValidJs(code));
});

test('_toJscad: sibling holes subtract from one solid (no union needed)', () => {
  const code = it._toJscad([sqPts(0, 0, 20), sqPts(-10, 0, 2), sqPts(10, 0, 2)]);
  assert.match(code, /return subtract\(solid0, hole0, hole1\);/);
  assert.ok(isValidJs(code));
});

test('_toJscad: concentric rings alternate solid/hole and keep the innermost', () => {
  // depths 0..4 → solids {0,2,4}, holes {1,3}
  const rings = [40, 25, 20, 12, 8].map(r => sqPts(50, 50, r));
  const code  = it._toJscad(rings);
  assert.equal(countPolys(code), 5, 'every concentric ring survives — incl. the innermost');
  assert.match(code, /union\(solid0, solid1, solid2\)/);
  assert.match(code, /subtract\(union\(.*\), hole0, hole1\)/);
  assert.ok(isValidJs(code));
});

// ─── _svgPathsToJscad: full pipeline (the ferrule regression) ─────────────────

test('_svgPathsToJscad: ferrule keeps all 5 features and drops noise + background', () => {
  const code = it._svgPathsToJscad(ferruleSvg(), 200, 200, 0);
  assert.ok(code, 'pipeline produced code');
  assert.equal(countPolys(code), 5, 'silhouette + 2 mouth rings (4 contours) = 5; speck & bg gone');
  assert.match(code, /union\(/,    'multiple solids are unioned');
  assert.match(code, /subtract\(/, 'odd-depth rings are subtracted as holes');
  assert.ok(isValidJs(code), 'generated JSCAD is syntactically valid');
});

test('_svgPathsToJscad: the area filter scales with region size', () => {
  // A huge region raises minArea (iw·ih·0.0002 = 800), so the two smallest
  // features (areas 900-ish→borderline, 256) fall out — proving the knob works.
  const code = it._svgPathsToJscad(ferruleSvg(), 2000, 2000, 0);
  assert.ok(code);
  assert.ok(countPolys(code) < 5, 'small inner ring dropped when the region is large');
});

test('_svgPathsToJscad: returns null when no dark paths are present', () => {
  const blank = pathEl(WHITE, sqD(50, 50, 40));
  assert.equal(it._svgPathsToJscad(blank, 200, 200, 0), null);
});
