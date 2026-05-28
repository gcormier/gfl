registerJscadStandard('iso10511', `// ISO 10511 / DIN 985 — Hexagon Nut with Nylon Insert (Nyloc)
// Taller nut with a filled nylon collar at the top that grips the thread.
const { circle, rectangle, polygon } = primitives;
const { subtract, union } = booleans;
const { translate } = transforms;

const HR = 7;
const HH = 9;       // nyloc nut is taller than standard
const HOLE_R = 2.7;
const COLLAR_H = HH * 0.25;  // nylon collar occupies top ~25%
const GAP = 5;

function hexPoints(cx, r) {
  return Array.from({length: 6}, (_, i) => {
    const a = i * Math.PI / 3;
    return [cx + r * Math.cos(a), r * Math.sin(a)];
  });
}

function main() {
  const hexTop  = polygon({ points: hexPoints(HR, HR) });
  const holeTop = translate([HR, 0], circle({ radius: HOLE_R, segments: 32 }));
  const topView = subtract(hexTop, holeTop);

  const flatToFlat = HR * Math.sqrt(3);
  const sideX0 = HR * 2 + GAP;

  // Main nut body
  const body = rectangle({ size: [flatToFlat, HH], center: [sideX0 + flatToFlat / 2, 0] });

  // Nylon collar: filled strip at the top of the side view
  const collar = rectangle({
    size: [flatToFlat - 0.8, COLLAR_H],
    center: [sideX0 + flatToFlat / 2, (HH - COLLAR_H) / 2],
  });

  return union(topView, union(body, collar));
}
`);
