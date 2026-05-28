registerJscadStandard('iso10642', `// ISO 10642 / DIN 7991 — Countersunk Flat Head Socket Screw
// Tapered head (wider at top, narrows to shaft). End view: circle with hex socket.
const { circle, polygon } = primitives;
const { subtract, union } = booleans;
const { translate } = transforms;

const SD = 4, SR = 2, SL = 22, GAP = 5;
const HD = 8, HL = 2.2, ER = 4;  // countersunk head is wide and short

function hexPoints(cx, r) {
  return Array.from({length: 6}, (_, i) => {
    const a = i * Math.PI / 3 + Math.PI / 6;
    return [cx + r * Math.cos(a), r * Math.sin(a)];
  });
}

function main() {
  // Tapered head: trapezoid from full width at left to shaft width at right
  const headPts = [
    [0,    -HD / 2],
    [HL,   -SR],
    [HL,    SR],
    [0,     HD / 2],
  ];
  const head  = polygon({ points: headPts });
  const shaftPts = [
    [HL,  -SR],
    [HL + SL, -SR],
    [HL + SL,  SR],
    [HL,   SR],
  ];
  const shaft = polygon({ points: shaftPts });
  const side = union(head, shaft);

  const endCx = HL + SL + GAP + ER;
  const endOuter = translate([endCx, 0], circle({ radius: ER, segments: 32 }));
  const socketHole = polygon({ points: hexPoints(endCx, ER * 0.40) });
  const end = subtract(endOuter, socketHole);

  return union(side, end);
}
`);
