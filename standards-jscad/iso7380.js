registerJscadStandard('iso7380', `// ISO 7380 — Button Head Socket Cap Screw
// Dome-shaped head (D-profile) + shaft. End view: circle with hex socket.
const { circle, rectangle, polygon } = primitives;
const { subtract, union } = booleans;
const { translate } = transforms;

const SD = 4, SL = 22, GAP = 5;
const HD = 5.2, HL = 3.0, ER = 2.6;  // dome head: shorter, wider

function hexPoints(cx, r) {
  return Array.from({length: 6}, (_, i) => {
    const a = i * Math.PI / 3 + Math.PI / 6;
    return [cx + r * Math.cos(a), r * Math.sin(a)];
  });
}

function main() {
  const domeR = HD / 2;

  // Full circle at x=HL (dome center at right edge of head)
  const fullDome = translate([HL, 0], circle({ radius: domeR, segments: 48 }));
  // Mask off the right half of the circle (keep dome bulging left)
  const rightMask = rectangle({ size: [domeR, HD * 2], center: [HL + domeR / 2, 0] });
  const dome = subtract(fullDome, rightMask);

  const shaft = rectangle({ size: [SL, SD], center: [HL + SL / 2, 0] });
  const side = union(dome, shaft);

  const endCx = HL + SL + GAP + ER;
  const endOuter = translate([endCx, 0], circle({ radius: ER, segments: 32 }));
  const socketHole = polygon({ points: hexPoints(endCx, ER * 0.45) });
  const end = subtract(endOuter, socketHole);

  return union(side, end);
}
`);
