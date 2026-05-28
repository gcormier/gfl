registerJscadStandard('iso4032', `// ISO 4032 / DIN 934 — Hexagon Nut (standard height)
// Top view: hexagon with thread hole. Side view: rectangular profile.
const { circle, rectangle, polygon } = primitives;
const { subtract, union } = booleans;
const { translate } = transforms;

const HR = 7;       // hex circumradius (top view)
const HH = 6;       // nut height (side view)
const HOLE_R = 2.7; // thread hole radius
const GAP = 5;

function hexPoints(cx, r) {
  return Array.from({length: 6}, (_, i) => {
    const a = i * Math.PI / 3;
    return [cx + r * Math.cos(a), r * Math.sin(a)];
  });
}

function main() {
  // Top view: hexagon with centre hole
  const hexTop  = polygon({ points: hexPoints(HR, HR) });
  const holeTop = translate([HR, 0], circle({ radius: HOLE_R, segments: 32 }));
  const topView = subtract(hexTop, holeTop);

  // Side view: rectangle (flat-to-flat width × height)
  const flatToFlat = HR * Math.sqrt(3);  // = HR × cos(30°) × 2
  const sideX0 = HR * 2 + GAP;
  const side = rectangle({ size: [flatToFlat, HH], center: [sideX0 + flatToFlat / 2, 0] });

  return union(topView, side);
}
`);
