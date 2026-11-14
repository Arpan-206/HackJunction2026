import type { ReactNode } from "react";

/*
 * Rail icons drawn like a page of a Renaissance notebook: iron-gall ink strokes of uneven weight, a little hand wobble,
 * thin hatching for shade. Everything uses currentColor, so the rail theme colours them. Drawn on a 24 unit grid and
 * shown at 26px; hairlines stay at 0.55 units or more so they survive at 1x.
 */

const HAIR = 0.55;

function Glyph({ children, size = 26, box = 24 }: { children: ReactNode; size?: number; box?: number }) {
  return (
    <svg
      className="ink-icon"
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A small filled ink dot: rivets, pins and string ends. */
function Dot({ x, y, r = 0.5 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />;
}

/** A toothed wheel as one closed outline, with a fixed per-tooth wobble so it looks cut by hand, not by a lathe. */
function gearPath(cx: number, cy: number, root: number, tip: number, teeth: number, rot = 0): string {
  const wobble = [0.08, -0.1, 0.05, -0.04, 0.11, -0.07, 0.02, -0.09, 0.06, -0.03];
  const step = (Math.PI * 2) / teeth;
  const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  let d = "";
  for (let i = 0; i < teeth; i++) {
    const a = rot + i * step;
    const w = wobble[i % wobble.length];
    const t = tip + w;
    const r = root - w / 2;
    d += `${i === 0 ? "M" : "L"}${pt(r, a)} L${pt(t, a + step * 0.16)} L${pt(t, a + step * 0.44)} L${pt(r, a + step * 0.6)} `;
  }
  return `${d}Z`;
}

/** Home: a bottega facade, pediment with an oculus over an arched, hatched doorway. */
export function IconHome() {
  return (
    <Glyph>
      <path d="M2.9 9.9Q7.5 6.6 12.05 3.4Q16.5 6.5 21.1 9.8" strokeWidth={1.7} />
      <path d="M4.6 9.1Q8.2 6.9 11.9 4.4" strokeWidth={HAIR} opacity={0.7} />
      <path d="M3.2 10.1Q12 9.7 20.8 10.05" strokeWidth={1.2} />
      <circle cx="12" cy="7.3" r="1.05" strokeWidth={0.9} />
      <path d="M5.1 10.4Q4.95 15.4 5.15 20.4M18.9 10.3Q19.05 15.3 18.85 20.4" strokeWidth={1.45} />
      <path d="M2.4 20.7Q12 20.25 21.6 20.6" strokeWidth={1.7} />
      <path d="M9.3 20.4V14.7Q9.35 11.9 12 11.85Q14.7 11.9 14.7 14.7V20.4" strokeWidth={1.35} />
      <path d="M10.65 20V13.5M12 20V12.8M13.35 20V13.5" strokeWidth={HAIR} />
      <path d="M16.5 19.7l1.5-1.5M16.5 17.3l1.5-1.5M16.5 14.9l1.5-1.5" strokeWidth={HAIR} />
    </Glyph>
  );
}

/** Expert: a brass pair of dividers, tapered legs with steel tips and a graduated quadrant wing. */
export function IconExpert() {
  return (
    <Glyph>
      <path d="M12 1.5Q12.15 2.5 12 3.3" strokeWidth={1.7} />
      <path d="M10.45 6.1L5.2 21.2L12 7.2Z" fill="currentColor" strokeWidth={0.45} />
      <path d="M13.55 6.1L18.8 21.2L12 7.2Z" fill="currentColor" strokeWidth={0.45} />
      <circle cx="12" cy="5" r="1.7" strokeWidth={1.3} />
      <Dot x={12} y={5} r={0.45} />
      <path d="M8.2 13.6Q12 15.7 15.8 13.5" strokeWidth={1} />
      <path d="M10 14.45l.15-.8M12 14.95v-.85M14 14.45l-.15-.8" strokeWidth={HAIR} />
      <path d="M6.05 17.35L7.45 17.95M17.95 17.35L16.55 17.95" strokeWidth={0.9} />
    </Glyph>
  );
}

/** Apprentice: an open sketchbook with ruled studies on one page and a quill set down on the other. */
export function IconApprentice() {
  return (
    <Glyph>
      <path d="M11.9 10.6Q7.4 8.6 2.7 9.9Q2.9 14.9 2.6 19.9Q7.3 18.7 11.9 20.5" strokeWidth={1.4} />
      <path d="M11.9 10.6Q16.6 8.6 21.3 9.9Q21.1 14.9 21.4 19.9Q16.7 18.7 11.9 20.5" strokeWidth={1.4} />
      <path d="M11.9 10.6Q11.8 15.5 11.9 20.5" strokeWidth={1} />
      <path d="M2.7 20Q2.8 21.1 3.5 21.05Q7.7 20.1 11.9 21.6Q16.1 20.1 20.5 21.05Q21.3 21.1 21.35 20" strokeWidth={0.9} />
      <path d="M4.3 12.4Q7 11.6 10.1 12.7M4.3 14.7Q7 13.9 10.1 15M4.3 17Q6 16.5 7.9 17" strokeWidth={HAIR} />
      <path d="M14.3 16.7Q17.6 10.6 21.9 2.4" strokeWidth={1} />
      <path d="M14.3 16.7L15.2 15.05" strokeWidth={1.6} />
      <path d="M21.9 2.4Q23.2 7.3 17.2 11.5Q16.4 6.4 21.9 2.4Z" strokeWidth={1} />
      <path d="M18.7 9.4l1.6-.5M19.5 7.5l1.5-.6M20.3 5.6l1.2-.6M18.2 8.1l-.8-.6M19.1 6.1l-.7-.7" strokeWidth={HAIR} />
    </Glyph>
  );
}

/** Robot: a mechanical hand after Leonardo's automata, jointed fingers on pins, a riveted hatched palm, a gear at the wrist. */
export function IconRobot() {
  return (
    <Glyph>
      <path d="M7.1 11.4Q12 10.7 16.9 11.3Q16.8 14.4 16 17.2Q12 17.8 8 17.2Q7.1 14.4 7.1 11.4Z" strokeWidth={1.5} />
      <path d="M8.9 10.9L8.65 7.95M8.5 6.6L8.3 3.6M12 10.7V7.15M12 5.85V2.6M15.1 10.9L15.35 7.95M15.5 6.6L15.7 3.7M7.3 14.2L5.3 12.55M4.3 11.4L3.5 9.1" strokeWidth={1.7} strokeLinecap="butt" />
      <path d="M8.3 3.6l-.05-.5M12 2.6v-.5M15.7 3.7l.05-.5M3.5 9.1l-.2-.45" strokeWidth={1.1} />
      <circle cx="8.57" cy="7.27" r="0.6" strokeWidth={0.75} />
      <circle cx="12" cy="6.5" r="0.6" strokeWidth={0.75} />
      <circle cx="15.43" cy="7.27" r="0.6" strokeWidth={0.75} />
      <circle cx="4.8" cy="11.98" r="0.6" strokeWidth={0.75} />
      <Dot x={9.3} y={13.1} r={0.5} />
      <Dot x={14.8} y={13.1} r={0.5} />
      <path d="M9.4 16.8l1.7-2.1M11.2 16.95l1.7-2.1M13 16.95l1.7-2.1" strokeWidth={HAIR} />
      <path d={gearPath(12, 20.75, 1.75, 2.65, 8, 0.2)} strokeWidth={0.95} />
      <Dot x={12} y={20.75} r={0.55} />
    </Glyph>
  );
}

/** Settings: a hand-cut cog with four spokes and one hatched sector, as in the notebook gear studies. */
export function IconSettings() {
  return (
    <Glyph>
      <path d={gearPath(12, 12, 7.5, 9.7, 9, -0.35)} strokeWidth={1.35} />
      <circle cx="12" cy="12" r="5.4" strokeWidth={0.8} />
      <circle cx="12" cy="12" r="1.9" strokeWidth={1.2} />
      <path d="M13.35 13.35L15.8 15.8M10.65 13.35L8.2 15.8M10.65 10.65L8.2 8.2M13.35 10.65L15.8 8.2" strokeWidth={1.1} />
      <path d="M10.5 16.95L12.1 15.35M12.1 17.3L13.1 16.3M9.4 16.3L10.6 15.1" strokeWidth={HAIR} />
    </Glyph>
  );
}

/** The Geppetto mark: a marionette control, crossed wooden bars with strings, inside a hand-drawn construction circle. */
export function BrandMark() {
  return (
    <Glyph size={40} box={32}>
      <circle cx="16" cy="16" r="12.8" strokeWidth={0.8} />
      <path d="M5.3 9.4A13.15 13.15 0 0 1 22.6 4.6" strokeWidth={HAIR} opacity={0.75} />
      <circle cx="16" cy="4.3" r="1" strokeWidth={0.9} />
      <path d="M16 5.4Q16.2 11.5 15.95 17.6" strokeWidth={2} />
      <path d="M7.1 10.6Q16 9.7 24.9 10.5" strokeWidth={2} />
      <path d="M12.2 16.6Q16 16.2 19.8 16.5" strokeWidth={1.6} />
      <circle cx="6.2" cy="10.7" r="0.95" strokeWidth={1} />
      <circle cx="25.8" cy="10.5" r="0.95" strokeWidth={1} />
      <path d="M9.4 11.1l1-1.2M11.6 10.9l1-1.2M19.6 10.8l1-1.2M21.8 10.9l1-1.2" strokeWidth={HAIR} />
      <path d="M6.4 11.9L8.4 24.8M25.6 11.7L23.6 24.8M12.3 17.4L13.3 26.6M19.7 17.3L18.7 26.6" strokeWidth={0.6} />
      <Dot x={8.45} y={25.1} r={0.75} />
      <Dot x={23.55} y={25.1} r={0.75} />
      <Dot x={13.35} y={26.9} r={0.75} />
      <Dot x={18.65} y={26.9} r={0.75} />
    </Glyph>
  );
}
