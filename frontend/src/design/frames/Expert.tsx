import { useMemo, useRef } from 'react';
import { Hand, Racket, synthFrame, type HandHandle } from '../../three';
import type { MotionSpec } from '../../api/types';
import { HandsControl } from '../../features/master/components/HandsControl';
import { PropSwitch } from '../../features/shared/PropSwitch';
import { Frame, Key, Primary, Steps, Tick } from '../kit';
import { Leaders, type LeaderNote } from '../Leaders';
import { SCALE, SCALE_DOWN, SWING, curlDeg, offFinger } from '../poses';
import { SceneCanvas, onHand, play, useBoard, useTicker } from '../scene';

const CAPTURE_STEPS = ['Choose', 'Capture', 'Publish'];
const CAM_ONE = { position: [3.1, 4.3, 4.6] as [number, number, number], target: [0.05, -0.25, -0.7] as [number, number, number] };
const CAM_TOP = { position: [1.4, 5.8, 3.3] as [number, number, number], target: [-0.35, -0.3, -0.8] as [number, number, number] };
const CAM_TWO = { position: [0.5, 6.4, 7.2] as [number, number, number], target: [0, -0.35, -0.75] as [number, number, number] };

/** Five flexion traces for a take, sampled from the same motion that drives the hand. */
function Lanes({ spec, upTo, dur = 4.5 }: { spec: MotionSpec; upTo: number; dur?: number }) {
  const W = 1000;
  const H = 130;
  const names = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
  const paths = useMemo(
    () =>
      names.map((_, i) => {
        const vals: number[] = [];
        for (let k = 0; k <= 120; k++) vals.push(curlDeg(synthFrame(spec, (k / 120) * dur), i));
        const lo = Math.min(...vals);
        const span = Math.max(0.5, Math.max(...vals) - lo);
        return vals
          .map((deg, k) => {
            const x = 92 + (k / 120) * (W - 110);
            const y = 14 + i * 24 + 9 - ((deg - lo) / span) * 16;
            return `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(' ');
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, dur],
  );
  const head = 92 + (upTo / dur) * (W - 110);
  return (
    <figure className="dz-lanes" aria-label="Finger flexion traces for this take">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id="lanes-upto">
            <rect x="0" y="0" width={head} height={H} />
          </clipPath>
        </defs>
        {paths.map((d, i) => (
          <g key={i}>
            <path d={d} className="dz-lanes__ghost" />
            <path d={d} className="dz-lanes__ink" clipPath="url(#lanes-upto)" />
          </g>
        ))}
        <path d={`M${head} 4V${H - 4}`} className="dz-lanes__head" />
      </svg>
      <div className="dz-lanes__names" aria-hidden="true">
        {names.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </figure>
  );
}

/** 1a. Set-up before the first take: hands choice, quiet prop switch, and an empty state that teaches. */
export function ExpertSetup() {
  const board = useBoard();
  const hand = useRef<HandHandle>(null);
  board.set('wrist', onHand(hand, 'wrist')).set('thumb', onHand(hand, 'thumb')).set('little', onHand(hand, 'little'));
  const notes: LeaderNote[] = [
    { id: 'thumb', n: 1, side: 'left', top: 70, width: 250, title: 'Right glove found', body: 'Live at 60 frames a second.' },
    { id: 'wrist', n: 2, side: 'left', top: 560, width: 250, title: 'Hold your hand flat', body: 'Two seconds still, and the glove calibrates itself.' },
    { id: 'little', n: 3, side: 'right', top: 70, width: 250, title: 'Then press Space', body: 'A three second count-in, then play the swing.' },
  ];
  return (
    <Frame world="codex" active="expert" title="Forehand swing" sub="A new move for Table tennis, plate I" aside={<Steps items={CAPTURE_STEPS} current={1} label="Capture progress" />}>
      <div className="dz-body">
        <section className="dz-stage dz-stage--plate" aria-label="Stage">
          <SceneCanvas world="codex" {...CAM_ONE} board={board} label="Your live glove as a sketched 3D hand resting on a parchment study sheet">
            <Hand ref={hand} style="sketch" side="right" />
          </SceneCanvas>
          <Leaders board={board} notes={notes} world="codex" />
          <p className="dz-stage__caption">Plate I, waiting for take 1</p>
        </section>
        <aside className="dz-panel" aria-label="Take set-up">
          <h2 className="dz-panel__h">Set up the take</h2>
          <HandsControl value="right" onChange={() => undefined} />
          <PropSwitch prop="racket" />
          <p className="dz-row">
            <span className="dz-ok">
              <Tick /> Glove calibrated
            </span>
            <button type="button" className="dz-link">
              Calibrate again
            </button>
          </p>
          <div className="dz-empty">
            <h3>No takes yet</h3>
            <p>Record the swing three times. The two takes that agree best become the hand learners train against.</p>
          </div>
          <div className="dz-panel__foot">
            <Primary k="Space">Record take 1</Primary>
            <p className="dz-hint">A three second count-in, then press Space again to stop.</p>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

/** 1b. Recording take 3, with live numbered study notes pinned to the 3D hand. */
export function ExpertRecording() {
  const board = useBoard();
  const hand = useRef<HandHandle>(null);
  board.set('index', onHand(hand, 'index:1')).set('thumb', onHand(hand, 'thumb:2')).set('wrist', onHand(hand, 'wrist'));
  const T = 0.05;
  const notes: LeaderNote[] = [
    { id: 'thumb', n: 1, side: 'left', top: 40, width: 240, title: 'Thumb braces the handle', body: 'Flat on the blade, 18 degrees.' },
    { id: 'index', n: 2, side: 'right', top: 56, width: 250, title: 'Index curls 31 degrees', body: 'Steady through the drive.' },
    { id: 'wrist', n: 3, side: 'right', top: 560, width: 250, title: 'Wrist opens 12 degrees', body: 'At contact, then closes.' },
  ];
  const tick = useTicker(1000);
  return (
    <Frame world="codex" active="expert" title="Forehand swing" sub="Table tennis, plate I" aside={<Steps items={CAPTURE_STEPS} current={1} label="Capture progress" />}>
      <div className="dz-body">
        <section className="dz-stage dz-stage--plate" aria-label="Stage">
          <p className="dz-rec" role="status">
            <span className="dz-rec__dot" aria-hidden="true" />
            Recording take 3, 0:0{4 + (tick % 5)}
          </p>
          <SceneCanvas world="codex" {...CAM_TOP} board={board} label="The expert's sketched 3D hand mid swing, holding a racket, with three numbered study notes">
            <Hand ref={hand} style="sketch" side="right" position={[0, 0.6, 0]} getFrame={play(SWING, T)}>
              <Racket rubber="#8C4A2E" />
            </Hand>
          </SceneCanvas>
          <Leaders board={board} notes={notes} world="codex" />
          <Lanes spec={SWING} upTo={T + 3} />
        </section>
        <aside className="dz-panel" aria-label="Takes">
          <h2 className="dz-panel__h">Takes</h2>
          <ol className="dz-takes">
            <li>
              <b>Take 1</b>
              <span>4.1 s, kept</span>
              <span className="dz-ok" aria-label="kept">
                <Tick />
              </span>
            </li>
            <li>
              <b>Take 2</b>
              <span>4.3 s, close to take 1</span>
              <span className="dz-ok" aria-label="kept">
                <Tick />
              </span>
            </li>
            <li className="is-now">
              <b>Take 3</b>
              <span>Recording now</span>
            </li>
          </ol>
          <HandsControl value="right" onChange={() => undefined} locked="Locked while recording." />
          <p className="dz-quiet">Racket shown. It is drawn only; the glove reads your fingers.</p>
          <dl className="dz-facts">
            <div>
              <dt>Steady so far</dt>
              <dd>4 of 5 fingers</dd>
            </div>
            <div>
              <dt>Take length</dt>
              <dd>up to 10 s</dd>
            </div>
          </dl>
          <div className="dz-panel__foot">
            <Primary k="Space">Stop take 3</Primary>
            <p className="dz-hint">Stopping keeps the take for review. Nothing is saved yet.</p>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

/** 1c. Reviewing takes of a two-hand move: kept takes as faint 3D ghosts, Keep on Enter, delete with Undo. */
export function ExpertReview() {
  const board = useBoard();
  const left = useRef<HandHandle>(null);
  const right = useRef<HandHandle>(null);
  const ghost = useRef<HandHandle>(null);
  board.set('lWrist', onHand(left, 'wrist')).set('rRing', onHand(right, 'ring')).set('ghost', onHand(ghost, 'little'));
  const T = 1.05;
  const notes: LeaderNote[] = [
    { id: 'ghost', n: 1, side: 'left', top: 60, width: 250, title: 'Faint hands: takes 1 and 2', body: 'Where they part, the move is loose.' },
    { id: 'lWrist', n: 2, side: 'left', top: 580, width: 250, title: 'Left hand agrees', body: 'Within 4 degrees on every finger.' },
    { id: 'rRing', n: 3, side: 'right', top: 60, width: 240, title: 'Right ring varies most', body: '9 degrees between takes.' },
  ];
  const tick = useTicker(1000);
  const left5 = Math.max(1, 3 - (tick % 3));
  return (
    <Frame world="codex" active="expert" title="C major scale" sub="Piano, both hands, plate II" aside={<Steps items={CAPTURE_STEPS} current={1} label="Capture progress" />}>
      <div className="dz-body">
        <section className="dz-stage dz-stage--plate" aria-label="Stage">
          <SceneCanvas world="codex" {...CAM_TWO} board={board} codex={{ sheet: { cx: 0, cz: -0.6, w: 7.4, d: 4.2 }, circle: 2.4 }} label="Two sketched hands replaying take 3, with faint sepia ghosts of the two kept takes">
            <Hand ref={left} style="sketch" side="left" position={[-1.15, 0, 0]} getFrame={play(SCALE_DOWN, T, 'left')} />
            <Hand ref={right} style="sketch" side="right" position={[1.15, 0, 0]} getFrame={play(SCALE, T, 'right')} />
            <Hand ref={ghost} style="ghost" tint="#5A3B1E" opacity={1.3} side="left" position={[-1.3, 0.08, -0.12]} getFrame={play(SCALE_DOWN, T + 0.3, 'left')} />
            <Hand style="ghost" tint="#5A3B1E" opacity={1.3} side="right" position={[1.3, 0.08, -0.12]} getFrame={offFinger(SCALE, T + 0.3, 3, 0.3)} />
          </SceneCanvas>
          <Leaders board={board} notes={notes} world="codex" />
          <p className="dz-stage__caption">Replaying take 3 over takes 1 and 2</p>
        </section>
        <aside className="dz-panel" aria-label="Review takes">
          <h2 className="dz-panel__h">Review take 3</h2>
          <ol className="dz-takes">
            <li>
              <b>Take 1</b>
              <span>4.0 s, kept</span>
              <span className="dz-ok" aria-label="kept">
                <Tick />
              </span>
            </li>
            <li>
              <b>Take 2</b>
              <span>4.2 s, kept</span>
              <span className="dz-ok" aria-label="kept">
                <Tick />
              </span>
            </li>
            <li className="is-now">
              <b>Take 3</b>
              <span>4.1 s, agrees 93 with your kept takes</span>
            </li>
          </ol>
          <p className="dz-row">
            <button type="button" className="dz-link">
              Delete take 3 <Key>Del</Key>
            </button>
            <button type="button" className="dz-link">
              Record take 5 <Key>Space</Key>
            </button>
          </p>
          <div className="dz-locked">
            <button type="button" className="btn btn--secondary" disabled>
              Save as lesson
            </button>
            <p className="dz-hint">Needs 3 kept takes. You have 2; keep take 3 to unlock it.</p>
          </div>
          <div className="dz-panel__foot">
            <Primary k="Enter">Keep take 3</Primary>
          </div>
          <div className="dz-toast" role="status">
            <span>Take 4 deleted.</span>
            <button type="button" className="dz-link dz-link--strong">
              Undo
            </button>
            <span className="dz-toast__time">{left5} s</span>
            <span className="dz-toast__bar" style={{ width: `${(left5 / 5) * 100}%` }} aria-hidden="true" />
          </div>
        </aside>
      </div>
    </Frame>
  );
}

/** 4c. An expert's take scored against the kept takes, on the codex sheet. */
export function ExpertScore() {
  const board = useBoard();
  const hand = useRef<HandHandle>(null);
  board.set('thumb', onHand(hand, 'thumb')).set('index', onHand(hand, 'index')).set('middle', onHand(hand, 'middle')).set('ring', onHand(hand, 'ring')).set('little', onHand(hand, 'little'));
  const T = 1.99;
  const notes: LeaderNote[] = [
    { id: 'index', side: 'left', top: 60, width: 210, title: 'Index 95' },
    { id: 'thumb', side: 'left', top: 330, width: 210, title: 'Thumb 97', body: 'Matches both takes.' },
    { id: 'middle', side: 'right', top: 30, width: 220, title: 'Middle 96' },
    { id: 'ring', side: 'right', top: 130, width: 250, tone: 'fix', title: 'Ring 81', body: 'Lifts early, 11 degrees above your takes.' },
    { id: 'little', side: 'right', top: 300, width: 220, title: 'Little 93' },
  ];
  return (
    <Frame world="codex" active="expert" title="C major scale" sub="Right hand, take 3 against your kept takes" aside={<Steps items={CAPTURE_STEPS} current={1} label="Capture progress" />}>
      <div className="dz-body">
        <section className="dz-stage dz-stage--plate" aria-label="Stage">
          <SceneCanvas world="codex" {...CAM_ONE} board={board} label="Take 3 as a sketched hand with a score note on a leader line to each finger">
            <Hand ref={hand} style="sketch" side="right" getFrame={offFinger(SCALE, T, 3, 0.35)} />
            <Hand style="ghost" tint="#5A3B1E" opacity={1.2} side="right" position={[0.1, 0.06, -0.1]} getFrame={play(SCALE, T)} />
          </SceneCanvas>
          <Leaders board={board} notes={notes} world="codex" />
          <p className="dz-stage__caption">Faint hand: takes 1 and 2</p>
        </section>
        <aside className="dz-panel" aria-label="Take score">
          <p className="dz-score">
            <span className="dz-score__n">94</span>
            <span className="dz-score__of">agreement with takes 1 and 2</span>
          </p>
          <p className="dz-body-text">Four fingers repeat your reference closely. The ring finger opens early at contact; keep this take if that was on purpose.</p>
          <dl className="dz-facts">
            <div>
              <dt>Length</dt>
              <dd>4.1 s</dd>
            </div>
            <div>
              <dt>Wrist</dt>
              <dd>within 3 degrees</dd>
            </div>
          </dl>
          <div className="dz-panel__foot">
            <Primary k="Enter">Keep take 3</Primary>
            <button type="button" className="dz-link">
              Record again <Key>Space</Key>
            </button>
          </div>
        </aside>
      </div>
    </Frame>
  );
}
