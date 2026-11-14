/** Points per string; the sag curve is smooth at this resolution. */
export const STRING_POINTS = 22;

/**
 * Writes the line segments of a hanging string between two points into `out` (6 floats per segment, STRING_POINTS - 1
 * segments). `slack` is 1 for a loose string and 0 for a taut straight one. The sag is parabolic with the real
 * rope-length relation, so a string with extra length hangs the way a thread would, bowing sideways in a fan so the
 * strings of neighbouring fingers never overlap.
 */
export function writeStringSegments(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  slack: number,
  fan: number,
  out: Float32Array,
): void {
  const cx = b[0] - a[0];
  const cy = b[1] - a[1];
  const cz = b[2] - a[2];
  const chord = Math.hypot(cx, cy, cz) || 1e-6;
  const extra = chord * 0.26 * Math.max(0, Math.min(1, slack));
  const sag = Math.sqrt((3 * chord * extra) / 8);

  // Bow direction: down and towards the viewer with a sideways fan, made perpendicular to the chord.
  let dx = fan;
  let dy = -0.55;
  let dz = 0.45;
  const along = (dx * cx + dy * cy + dz * cz) / (chord * chord);
  dx -= along * cx;
  dy -= along * cy;
  dz -= along * cz;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl;
  dy /= dl;
  dz /= dl;

  let px = a[0];
  let py = a[1];
  let pz = a[2];
  for (let i = 1; i < STRING_POINTS; i++) {
    const u = i / (STRING_POINTS - 1);
    const bow = 4 * u * (1 - u) * sag;
    const x = a[0] + cx * u + dx * bow;
    const y = a[1] + cy * u + dy * bow;
    const z = a[2] + cz * u + dz * bow;
    const o = (i - 1) * 6;
    out[o] = px;
    out[o + 1] = py;
    out[o + 2] = pz;
    out[o + 3] = x;
    out[o + 4] = y;
    out[o + 5] = z;
    px = x;
    py = y;
    pz = z;
  }
}
