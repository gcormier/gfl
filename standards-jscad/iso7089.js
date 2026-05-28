registerJscadStandard('iso7089', `// ISO 7089 / DIN 125 — Plain Washer (standard size)
// Top view: donut (outer circle minus inner hole). Side view: thin strip.
const { circle, rectangle } = primitives;
const { subtract, union } = booleans;
const { translate } = transforms;

const OR = 7;    // outer radius
const IR = 2.7;  // inner radius (thread hole)
const T  = 1.2;  // thickness
const GAP = 5;

function main() {
  // Top view: donut
  const outer = translate([OR, 0], circle({ radius: OR, segments: 48 }));
  const inner = translate([OR, 0], circle({ radius: IR, segments: 32 }));
  const topView = subtract(outer, inner);

  // Side view: thin rectangle
  const sideX0 = OR * 2 + GAP;
  const side = rectangle({ size: [OR * 2, T], center: [sideX0 + OR, 0] });

  return union(topView, side);
}
`);
