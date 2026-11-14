import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, Mesh, MeshBasicMaterial, TorusGeometry, Vector3, type InstancedInterleavedBuffer } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Finger } from '../../api/types';
import { Hand, type HandHandle } from '../../three';
import { FINGER_ORDER } from '../../three/anatomy';
import { Crossbar } from '../../features/apprentice/training/modes/Strings';
import { STRING_POINTS, writeStringSegments } from '../../features/apprentice/training/modes/stringMath';
import { Frame, Ladder, Meter, Primary } from '../kit';
import { Leaders, type LeaderNote } from '../Leaders';
import { SCALE, offFinger } from '../poses';
import { SceneCanvas, onHand, play, useBoard } from '../scene';

const LIFT = 1.25;
const CAM_STRINGS = { position: [4.4, 2.6, 4.0] as [number, number, number], target: [0, 0.6, -0.9] as [number, number, number] };
const CAM_GHOST = { position: [1.6, 3.8, 3.6] as [number, number, number], target: [0, -0.3, -0.95] as [number, number, number] };
const FAN = [-1.1, -0.55, 0, 0.55, 1.1];

/**
 * Marionette threads from each expert fingertip to the learner's fingertip. dropped: the threads have been let go and
 * hang loose from the expert's fingers, the first moment of the hand-off.
 */
function Threads({ master, learner, dropped = false }: { master: RefObject<HandHandle>; learner: RefObject<HandHandle>; dropped?: boolean }) {
  const size = useThree((s) => s.size);
  const built = useMemo(() => {
    const g = new Group();
    const lines = FINGER_ORDER.map(() => {
      const geo = new LineGeometry();
      geo.setPositions(new Float32Array(STRING_POINTS * 3));
      const mat = new LineMaterial({ color: new Color('#F4F1EA').getHex(), linewidth: 3.6, worldUnits: false, transparent: true, opacity: dropped ? 0.75 : 1 });
      const l = new Line2(geo, mat);
      l.frustumCulled = false;
      g.add(l);
      return l;
    });
    return { g, lines };
  }, [dropped]);
  useEffect(
    () => () =>
      built.lines.forEach((l) => {
        l.geometry.dispose();
        (l.material as LineMaterial).dispose();
      }),
    [built],
  );
  const s = useMemo(() => ({ a: new Vector3(), b: new Vector3(), seg: new Float32Array((STRING_POINTS - 1) * 6) }), []);
  useFrame(() => {
    const m = master.current;
    const l = learner.current;
    if (!m || !l) return;
    FINGER_ORDER.forEach((f, i) => {
      m.getTipWorld(f, s.a);
      if (dropped) {
        // Let go: each thread falls to the bench a little ahead of the fingertip, coiling slack.
        l.getTipWorld(f, s.b);
        s.b.set(s.a.x + FAN[i] * 0.18, -0.53, s.a.z + 0.45 + i * 0.04);
      } else l.getTipWorld(f, s.b);
      writeStringSegments([s.a.x, s.a.y, s.a.z], [s.b.x, s.b.y, s.b.z], dropped ? 1 : 0.35, FAN[i], s.seg);
      const line = built.lines[i];
      const attr = line.geometry.attributes.instanceStart as unknown as { data: InstancedInterleavedBuffer };
      attr.data.array.set(s.seg);
      attr.data.needsUpdate = true;
      (line.material as LineMaterial).resolution.set(size.width, size.height);
    });
  });
  return <primitive object={built.g} />;
}

/** One vermilion ring around a fingertip, always facing the viewer: the single correction on screen. */
function FixRing({ hand, finger }: { hand: RefObject<HandHandle>; finger: Finger }) {
  const camera = useThree((s) => s.camera);
  const mesh = useMemo(() => {
    const m = new Mesh(new TorusGeometry(0.17, 0.022, 10, 48), new MeshBasicMaterial({ color: '#D8432A', depthTest: false, transparent: true }));
    m.renderOrder = 10;
    m.userData.noCast = true;
    return m;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    },
    [mesh],
  );
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const h = hand.current;
    if (!h) return;
    h.getTipWorld(finger, v);
    mesh.position.copy(v);
    mesh.quaternion.copy(camera.quaternion);
  });
  return <primitive object={mesh} />;
}

const T = 1.99;

/** 3a. Watch: the expert's hand works the marionette cross, and its strings move the learner's wooden hand. */
export function RoomWatch() {
  const master = useRef<HandHandle>(null);
  const learner = useRef<HandHandle>(null);
  return (
    <Frame world="field" active="learner" title="C major scale" sub="Piano, right hand, lesson 1, step 2" aside={<Ladder current={0} />}>
      <div className="dz-body">
        <section className="dz-stage" aria-label="Training stage">
          <SceneCanvas world="bench" {...CAM_STRINGS} bench={{ circle: 1.6 }} label="The expert's chalk hand hangs from a wooden marionette cross and pulls the learner's wooden hand by five strings">
            <Hand ref={learner} style="wood" side="right" getFrame={play(SCALE, T, 'right', 0.1)} />
            <Hand ref={master} style="chalk" side="right" position={[0, LIFT, 0]} getFrame={play(SCALE, T)} />
            <Crossbar master={master} height={0.95} />
            <Threads master={master} learner={learner} />
          </SceneCanvas>
          <p className="dz-stagehint">
            <b>Watch</b>The expert&rsquo;s strings move your hand. Keep yours loose and feel the timing.
          </p>
        </section>
        <aside className="dz-panel" aria-label="Watch">
          <h2 className="dz-panel__h">Watch the expert</h2>
          <p className="dz-body-text">The expert plays the scale three times. Each string pulls one of your fingers, so you feel the move before you make it.</p>
          <div className="dz-locked">
            <span className="dz-meter__label">Loop 2 of 3</span>
            <span className="dz-story" aria-hidden="true" style={{ width: '100%' }}>
              <span className="is-on" />
              <span className="is-on" />
              <span />
            </span>
          </div>
          <div className="dz-panel__foot">
            <Primary k="Space">Take the strings</Primary>
            <p className="dz-hint">After the third loop the strings pass to you anyway.</p>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

const MOMENTS = [
  { title: 'The strings let go', body: 'The threads fall from your fingers. Your hand is your own now.' },
  { title: 'The hand becomes a ghost', body: 'The expert’s hand turns to light and sinks towards yours.' },
  { title: 'The ghost settles on your hand', body: 'Fill the ghost with your fingers. That is the whole game.' },
];

/** 3b. The hand-off in three moments (?m=1, 2, 3): strings drop, the expert's hand turns ghost, the ghost settles. */
export function RoomHandoff() {
  const m = Math.min(3, Math.max(1, Number(new URLSearchParams(window.location.search).get('m') ?? '1')));
  const master = useRef<HandHandle>(null);
  const learner = useRef<HandHandle>(null);
  const cam = m === 3 ? CAM_GHOST : CAM_STRINGS;
  const mo = MOMENTS[m - 1];
  return (
    <Frame world="field" active="learner" title="C major scale" sub="Piano, right hand, lesson 1, step 2" aside={<Ladder current={m === 3 ? 2 : 1} />}>
      <div className="dz-body">
        <section className="dz-stage" aria-label="Training stage">
          <SceneCanvas world="bench" {...cam} bench={{ circle: 1.6 }} label={`Hand-off, moment ${m} of 3: ${mo.title}`}>
            <Hand ref={learner} style="wood" side="right" getFrame={play(SCALE, T, 'right', 0.06)} />
            {m === 1 && (
              <>
                <Hand ref={master} style="chalk" side="right" position={[0, LIFT, 0]} getFrame={play(SCALE, T)} />
                <Crossbar master={master} height={0.95} />
                <Threads master={master} learner={learner} dropped />
              </>
            )}
            {m === 2 && (
              <>
                <Hand style="ghost" side="right" opacity={0.45} position={[0, LIFT, 0]} scale={1.05} getFrame={play(SCALE, T)} />
                <Hand style="ghost" side="right" opacity={1.6} position={[0, LIFT * 0.48, 0.03]} scale={1.09} getFrame={play(SCALE, T)} />
              </>
            )}
            {m === 3 && <Hand style="ghost" side="right" opacity={1.5} position={[0, 0.02, 0.05]} scale={1.12} getFrame={play(SCALE, T)} />}
          </SceneCanvas>
          <p className="dz-stagehint">
            <b>{mo.title}</b>
            {mo.body}
          </p>
        </section>
        <aside className="dz-panel" aria-label="Hand-off">
          <h2 className="dz-panel__h">{m === 3 ? 'Your turn' : 'Passing the hand'}</h2>
          <div className="dz-locked">
            <span className="dz-meter__label">Hand-off, moment {m} of 3</span>
            <span className="dz-story" aria-hidden="true" style={{ width: '100%' }}>
              <span className="is-on" />
              <span className={m >= 2 ? 'is-on' : ''} />
              <span className={m >= 3 ? 'is-on' : ''} />
            </span>
          </div>
          <p className="dz-body-text">
            {m === 3
              ? 'The ghost now moves with the expert’s timing. Play the scale inside it; the one finger that drifts gets a single red ring.'
              : 'Two seconds of hand-off, so the change from being moved to moving yourself never comes as a surprise.'}
          </p>
          <div className="dz-panel__foot">
            <Primary k="Space" disabled={m < 3}>
              Start rep 1
            </Primary>
            <p className="dz-hint">{m < 3 ? 'Ready when the ghost settles, in about 2 s.' : 'Five reps; three clean ones learn the step.'}</p>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

/** 3c. Training inside the ghost: one vermilion ring on the worst finger with a plaster label, and a calm meter. */
export function RoomGhost() {
  const learner = useRef<HandHandle>(null);
  const board = useBoard();
  board.set('ring', onHand(learner, 'ring'));
  const notes: LeaderNote[] = [{ id: 'ring', side: 'right', top: 120, width: 250, tone: 'fix', title: 'Ring finger', body: 'Press it 14 degrees deeper.' }];
  return (
    <Frame world="field" active="learner" title="C major scale" sub="Piano, right hand, lesson 1, step 2" aside={<Ladder current={2} />}>
      <div className="dz-body">
        <section className="dz-stage" aria-label="Training stage">
          <SceneCanvas world="bench" {...CAM_GHOST} board={board} bench={{ circle: 1.6, props: false }} label="The learner's wooden hand inside the expert's translucent ghost, a red ring around the ring finger">
            <Hand ref={learner} style="wood" side="right" getFrame={offFinger(SCALE, T, 3, 0.35)} />
            <Hand style="ghost" side="right" opacity={1.4} position={[0, 0.02, 0.05]} scale={1.12} getFrame={play(SCALE, T)} />
            <FixRing hand={learner} finger="ring" />
          </SceneCanvas>
          <Leaders board={board} notes={notes} world="field" />
          <div className="dz-roomtop">
            <span className="dz-roomtop__rep">Rep 2 of 5</span>
            <span className="dz-hint">1 clean rep so far</span>
          </div>
        </section>
        <aside className="dz-panel" aria-label="Rep">
          <h2 className="dz-panel__h">Inside the ghost</h2>
          <Meter value={82} label="Match" />
          <p className="dz-body-text">Four fingers sit inside the ghost. Fix the ring finger and this rep counts as clean.</p>
          <dl className="dz-facts">
            <div>
              <dt>Clean reps</dt>
              <dd>1 of 3 needed</dd>
            </div>
            <div>
              <dt>Timing</dt>
              <dd>on the beat</dd>
            </div>
          </dl>
          <div className="dz-panel__foot">
            <Primary k="Space">Stop rep</Primary>
            <p className="dz-hint">The rep ends by itself after the scale.</p>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

/** 3d. Blind rep: no ghost and no strings, play it from memory; the score waits until the end. */
export function RoomBlind() {
  return (
    <Frame world="field" active="learner" title="C major scale" sub="Piano, right hand, lesson 1, step 2" aside={<Ladder current={3} />}>
      <div className="dz-body">
        <section className="dz-stage" aria-label="Training stage">
          <SceneCanvas world="bench" {...CAM_GHOST} bench={{ circle: 1.6, props: false }} label="Only the learner's wooden hand on the bench: a blind rep">
            <Hand style="wood" side="right" getFrame={play(SCALE, T + 0.2)} />
          </SceneCanvas>
          <div className="dz-roomtop">
            <span className="dz-roomtop__rep">Blind rep 1 of 2</span>
            <span className="dz-hint">No ghost, no strings</span>
          </div>
          <p className="dz-stagehint">
            <b>From memory</b>Play the scale on your own. Your score shows when the rep ends.
          </p>
        </section>
        <aside className="dz-panel" aria-label="Blind rep">
          <h2 className="dz-panel__h">Play it blind</h2>
          <p className="dz-body-text">This is the real test of the step. The scorer still watches every finger; it just stays quiet until you finish.</p>
          <div className="dz-empty">
            <h3>The meter is hidden</h3>
            <p>Hiding it stops you chasing the number and makes you trust your hand.</p>
          </div>
          <div className="dz-panel__foot">
            <Primary k="Space">Stop rep</Primary>
            <p className="dz-hint">Two blind reps at 80 or more seal the step.</p>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

