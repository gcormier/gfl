registerJscadStandard('iso4762', `// ISO 4762 / DIN 912 — Hexagon Socket Head Cap Screw
// Side view: cylindrical head + shaft. End view: circle with hex socket.
const { circle, rectangle, polygon } = primitives;
const { subtract, union } = booleans;
const { translate } = transforms;

const SD = 4, SL = 22, GAP = 5;  // shaft diameter, length, end-view gap
const HD = 6, HL = 3.6, ER = 3;  // head diameter, length, end-view radius

function hexPoints(cx, r) {
  return Array.from({length: 6}, (_, i) => {
    const a = i * Math.PI / 3 + Math.PI / 6;
    return [cx + r * Math.cos(a), r * Math.sin(a)];
  });
}

function main() {
  const head  = rectangle({ size: [HL, HD], center: [HL / 2, 0] });
  const shaft = rectangle({ size: [SL, SD], center: [HL + SL / 2, 0] });
  const side  = union(head, shaft);

  const endCx = HL + SL + GAP + ER;
  const endOuter = translate([endCx, 0], circle({ radius: ER, segments: 32 }));
  const socketHole = polygon({ points: hexPoints(endCx, ER * 0.45) });
  const end = subtract(endOuter, socketHole);

  return union(side, end);
}
`);
