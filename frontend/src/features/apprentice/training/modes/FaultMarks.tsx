import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CatmullRomCurve3, Mesh, MeshBasicMaterial, TubeGeometry, Vector3 } from 'three';
import { FINGERS, type Finger } from '../../../../api/types';
import type { HandHandle } from '../../../../three';
import { useStageColors } from '../../../../three';
import type { AttemptPolicy } from '../coach/fade';
import { flaggedFinger, type ToleranceBand } from '../coach/deviation';
import { fingerTip } from '../coach/tips';
import type { Coach } from '../coach/useCoach';

const RING_RADIUS = 0.14;
const SCALE_RATE = 14;
/** Gap between the stage edge and the correction label, in CSS pixels. */
const LABEL_INSET = 16;
/** How far the leader's foot stays inside the label's top edge, in CSS pixels. */
const LEADER_MARGIN = 18;
/** The label only swaps corners once the fingertip is clearly on the other side (normalised screen x), so it never flickers. */
const SIDE_HYSTERESIS = 0.12;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A hand-drawn closed-ish loop: the radius wobbles, and the pen overshoots the start a little, as a quill would. */
function ringCurve(seed: number): CatmullRomCurve3 {
  const pts: Vector3[] = [];
  const steps = 26;
  const sweep = Math.PI * 2 * 1.1;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * sweep + seed;
    const r = RING_RADIUS * (1 + 0.09 * Math.sin(2 * a + seed * 3) + 0.045 * Math.sin(3 * a + seed) + 0.1 * (i / steps));
    pts.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.92, 0));
  }
  return new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

interface FaultMarksProps {
  /** The learner's wooden hand. */
  hand: RefObject<HandHandle>;
  coach: Coach;
  policy: AttemptPolicy;
  /** One band for every finger, or each finger's own (after the margin): sets how strongly the label words a correction. */
  toleranceDeg: ToleranceBand;
}

interface Label {
  box: HTMLDivElement;
  svg: SVGSVGElement;
  line: SVGLineElement;
  foot: SVGCircleElement;
}

/** Builds the correction label and its leader line as plain DOM on top of the canvas, so no text is drawn into the scene. */
function mountLabel(host: HTMLElement): Label {
  const box = document.createElement('div');
  box.className = 'ap-fault-label';
  box.setAttribute('aria-hidden', 'true');
  box.dataset.side = 'left';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ap-fault-leader');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SVG_NS, 'line');
  const foot = document.createElementNS(SVG_NS, 'circle');
  foot.setAttribute('r', '4');
  svg.append(line, foot);
  host.append(svg, box);
  return { box, svg, line, foot };
}

/**
 * The correction marks: a vermilion hand-inked ring round each fingertip that is outside the tolerance, drawn in the scene,
 * and, for the worst one, an opaque plaster label pinned to the bottom edge of the stage ("Ring finger: curl a little more")
 * with a leader line to its ring. The label sits on top of the canvas, not in the 3D picture, so it is never clipped or lost
 * against the set. Fingers in line get nothing. All updates happen in the render loop, never through React state.
 */
export function FaultMarks({ hand, coach, policy, toleranceDeg }: FaultMarksProps) {
  const stage = useStageColors();
  const gl = useThree((s) => s.gl);
  const rings = useRef<(Mesh | null)[]>([]);
  const label = useRef<Label | null>(null);
  const lastNote = useRef('');
  const labelSize = useRef({ w: 0, h: 0 });
  const tmp = useMemo(() => new Vector3(), []);
  const edge = useMemo(() => new Vector3(), []);
  const right = useMemo(() => new Vector3(), []);
  const geos = useMemo(() => FINGERS.map((_, i) => new TubeGeometry(ringCurve(i * 1.7 + 0.4), 64, 0.0105, 5, false)), []);
  const mat = useMemo(() => new MeshBasicMaterial({ color: stage.vermilion, transparent: true, opacity: 0.95, depthTest: false }), [stage.vermilion]);
  useEffect(
    () => () => {
      geos.forEach((g) => g.dispose());
    },
    [geos],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    const host = gl.domElement.parentElement;
    if (!host) return;
    const l = mountLabel(host);
    label.current = l;
    lastNote.current = '';
    return () => {
      l.box.remove();
      l.svg.remove();
      label.current = null;
    };
  }, [gl]);

  useFrame(({ camera, size }, dt) => {
    const h = hand.current;
    const live = coach.live.current;
    const guiding = Boolean(h) && policy.liveCoach && !policy.rehearsal && live.hasLearner;
    // The same published snapshot and the same rule as the match meter: only a finger whose status is 'off' is marked.
    const snap = live.shown;
    const flagged = guiding ? flaggedFinger(snap, policy.focus) : null;
    const worst = flagged ? { finger: flagged, deviationDeg: snap.deviation[flagged] } : null;
    FINGERS.forEach((f: Finger, i) => {
      const m = rings.current[i];
      if (!m) return;
      const want = guiding && snap.status[f] === 'off' && (!policy.focus || policy.focus.includes(f)) ? 1 : 0;
      const s = m.scale.x + (want - m.scale.x) * Math.min(1, dt * SCALE_RATE);
      m.scale.setScalar(Math.max(0.0001, s));
      m.visible = s > 0.02;
      if (m.visible && h) {
        h.getTipWorld(f, tmp);
        m.position.copy(tmp);
        m.quaternion.copy(camera.quaternion);
      }
    });

    const l = label.current;
    if (!l) return;
    if (!worst || !h) {
      l.box.classList.remove('is-on');
      l.svg.classList.remove('is-on');
      return;
    }
    const text = fingerTip(worst.finger, worst.deviationDeg, toleranceDeg);
    if (lastNote.current !== text) {
      lastNote.current = text;
      l.box.textContent = text;
      labelSize.current = { w: l.box.offsetWidth, h: l.box.offsetHeight };
    }

    // Fingertip and ring radius in CSS pixels.
    h.getTipWorld(worst.finger, tmp);
    right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(RING_RADIUS * 1.15);
    edge.copy(tmp).add(right).project(camera);
    tmp.project(camera);
    const tx = (tmp.x * 0.5 + 0.5) * size.width;
    const ty = (-tmp.y * 0.5 + 0.5) * size.height;
    const ringPx = Math.hypot((edge.x - tmp.x) * 0.5 * size.width, (edge.y - tmp.y) * 0.5 * size.height);

    // Pin the label to the bottom corner on the fingertip's side, so the leader stays short, unless the label would cover
    // the ring itself: then it takes the other corner.
    const { w, h: lh } = labelSize.current;
    const top = size.height - LABEL_INSET - lh;
    const leftOf = (s: string) => (s === 'left' ? LABEL_INSET : size.width - LABEL_INSET - w);
    const covers = (s: string) => ty + ringPx > top && tx + ringPx > leftOf(s) && tx - ringPx < leftOf(s) + w;
    const current = l.box.dataset.side ?? 'left';
    let side = current === 'right' ? (tmp.x < -SIDE_HYSTERESIS ? 'left' : 'right') : tmp.x > SIDE_HYSTERESIS ? 'right' : 'left';
    const other = side === 'left' ? 'right' : 'left';
    if (covers(side) && !covers(other)) side = other;
    else if (covers(side) && covers(other)) {
      // A narrow stage: both corners touch the ring, so take the one whose label centre is further from it.
      const far = (s: string) => Math.abs(leftOf(s) + w / 2 - tx);
      side = far('left') >= far('right') ? 'left' : 'right';
    }
    if (current !== side) l.box.dataset.side = side;
    const left = leftOf(side);
    // The leader leaves the label from the top edge, or from a side edge when the ring sits beside the label.
    const beside = tx < left || tx > left + w;
    const fx = beside ? (tx < left ? left : left + w) : Math.min(left + w - LEADER_MARGIN, Math.max(left + LEADER_MARGIN, tx));
    const fy = beside ? Math.min(top + lh / 2, Math.max(top, ty)) : top;
    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy);
    const reach = Math.max(0, len - ringPx);
    const ex = len > 0 ? fx + (dx / len) * reach : fx;
    const ey = len > 0 ? fy + (dy / len) * reach : fy;
    l.line.setAttribute('x1', fx.toFixed(1));
    l.line.setAttribute('y1', fy.toFixed(1));
    l.line.setAttribute('x2', ex.toFixed(1));
    l.line.setAttribute('y2', ey.toFixed(1));
    l.foot.setAttribute('cx', fx.toFixed(1));
    l.foot.setAttribute('cy', fy.toFixed(1));
    // No leader when the ring sits on the label itself (or behind the camera); the label alone still reads.
    const onLabel = tx >= left && tx <= left + w && ty >= top;
    l.svg.classList.toggle('is-on', !onLabel && reach > 4 && tmp.z < 1);
    l.box.classList.add('is-on');
  });

  return (
    <>
      {FINGERS.map((f, i) => (
        <mesh
          key={f}
          ref={(m) => {
            rings.current[i] = m;
          }}
          geometry={geos[i]}
          material={mat}
          renderOrder={20}
          visible={false}
          scale={0.0001}
        />
      ))}
    </>
  );
}
