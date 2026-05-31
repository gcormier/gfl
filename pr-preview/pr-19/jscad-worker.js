// Web Worker: safely evaluates user JSCAD code in a sandboxed context.
// Loaded via Blob URL from jscad-editor.js — no DOM access here.

importScripts('https://unpkg.com/@jscad/modeling@2.13.0/dist/jscad-modeling.min.js');

self.onmessage = function (e) {
  const { code } = e.data;

  try {
    // Expose jscad namespaces as named function arguments so user code
    // can destructure at the top without any require() shim.
    const fn = new Function(
      'primitives',
      'booleans',
      'transforms',
      'expansions',
      'hulls',
      'measurements',
      'maths',
      'utils',
      code + '\nreturn main();'
    );

    const raw = fn(
      jscadModeling.primitives,
      jscadModeling.booleans,
      jscadModeling.transforms,
      jscadModeling.expansions,
      jscadModeling.hulls,
      jscadModeling.measurements,
      jscadModeling.maths,
      jscadModeling.utils
    );

    // Accept single geom2 or array of geom2
    const shapes = Array.isArray(raw) ? raw : [raw];

    // Validate all shapes are 2D geometry (geom2 has a 'sides' array)
    for (const s of shapes) {
      if (!s || !Array.isArray(s.sides)) {
        throw new Error('main() must return 2D geometry (geom2). Got: ' + (s ? s.type || typeof s : 'null'));
      }
    }

    // Extract polygon outlines — each outline is [[x,y], ...]
    const outlines = shapes.flatMap(s =>
      jscadModeling.geometries.geom2.toOutlines(s)
    );

    // Compute bounding box across all points
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const outline of outlines) {
      for (const [x, y] of outline) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (!isFinite(minX)) {
      throw new Error('main() returned empty geometry — no outlines produced.');
    }

    self.postMessage({ ok: true, outlines, bbox: { minX, minY, maxX, maxY } });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
