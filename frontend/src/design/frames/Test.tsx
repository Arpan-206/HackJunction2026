import { useEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshToonMaterial, Vector3 } from 'three';
import type { GloveFrame } from '../../api/types';
import type { GloveStreamHandle } from '../../api';
import { CODEX_STAGE, Hand, Racket, getParchmentUrl, synthFrame, withHatching, type HandHandle } from '../../three';
import { toonGradient } from '../../three/materials';
import { RallyScene } from '../../features/apprentice/test/TableTennisRally/RallyScene';
import { RallyGame } from '../../features/apprentice/test/TableTennisRally/rally';
import { TABLE } from '../../features/apprentice/test/TableTennisRally/ball';
import { Frame, Key, Primary } from '../kit';
import { Leaders, type LeaderNote } from '../Leaders';
import { SCALE, SWING } from '../poses';
import { SceneCanvas, onHand, play, useBoard } from '../scene';

/** 5a. The live match, today's 3D rally scene, with score numerals sized for 3 m. */
export function TestMatch() {
  const game = useMemo(() => {
    const g = new RallyGame({ twoPlayer: false, rounds: 3 });
    g.phase = 'flight';
    g.points = { a: 3, b: 2 };
    g.round = 2;
    g.rally = 4;
    g.ball.p = { x: 0.18, y: TABLE.top + 0.32, z: 0.55 };
    g.paddle = { a: { x: 0.3, y: 0.98 }, b: { x: -0.2, y: 0.95 } };
    return g;
  }, []);
  const gloves = useMemo<GloveStreamHandle>(() => {
    const frame: GloveFrame = { t: 0, source: 'replay', hands: [synthFrame(SWING, 0.35, 'right')] };
    return { status: 'open', latest: { current: frame }, onFrame: () => () => undefined, setMotion: () => undefined };
  }, []);
  return (
    <Frame world="field" active="learner" title="Test your skills" sub="Table tennis, against the bot" aside={<Scoreboard />}>
      <div className="dz-body dz-body--full">
        <section className="dz-stage" aria-label="Match">
          <RallyScene game={game} gloves={gloves} twoPlayer={false} />
          <div className="dz-matchbar">
            <span className="dz-matchbar__tip">Racket face level at contact</span>
            <button type="button" className="btn btn--secondary">
              Pause <Key>Esc</Key>
            </button>
          </div>
        </section>
      </div>
    </Frame>
  );
}

function Scoreboard() {
  return (
    <>
          <div className="dz-board" role="status" aria-label="Score: You 3, The bot 2. Round 2 of 3, first to 5.">
            <span className="dz-board__side">
              <span className="dz-board__who">You</span>
              <span className="dz-board__n">3</span>
            </span>
            <span className="dz-board__mid">
              <b>Round 2 of 3</b>
              <span>first to 5, rally of 4</span>
            </span>
            <span className="dz-board__side dz-board__side--them">
              <span className="dz-board__n">2</span>
              <span className="dz-board__who">The bot</span>
            </span>
          </div>
    </>
  );
}

/** A table tennis table drawn as a lit codex sketch, with landing marks inked on it. */
function SketchTable({ marks }: { marks: { x: number; z: number; fix?: boolean }[] }) {
  const built = useMemo(() => {
    const g = new Group();
    const top = withHatching(new MeshToonMaterial({ color: '#EFE2C4', gradientMap: toonGradient() }), { ink: CODEX_STAGE.ink, strength: 0.6, base: 1.0 });
    const ink = new MeshBasicMaterial({ color: CODEX_STAGE.ink });
    const verm = new MeshBasicMaterial({ color: '#B2321B' });
    const w = TABLE.halfWidth * 2;
    const l = TABLE.halfLength * 2;
    const add = (geo: BoxGeometry, mat: MeshBasicMaterial | MeshToonMaterial, x: number, y: number, z: number, ry = 0) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      g.add(m);
      return m;
    };
    add(new BoxGeometry(w, 0.04, l), top, 0, 0, 0);
    // rim lines and the centre line, drawn as inked strips
    add(new BoxGeometry(w, 0.005, 0.018), ink, 0, 0.022, l / 2 - 0.01);
    add(new BoxGeometry(w, 0.005, 0.018), ink, 0, 0.022, -l / 2 + 0.01);
    add(new BoxGeometry(0.018, 0.005, l), ink, w / 2 - 0.01, 0.022, 0);
    add(new BoxGeometry(0.018, 0.005, l), ink, -w / 2 + 0.01, 0.022, 0);
    add(new BoxGeometry(0.01, 0.005, l), ink, 0, 0.022, 0);
    const net = new Mesh(new BoxGeometry(TABLE.netHalfWidth * 2 - 0.15, 0.15, 0.012), top);
    net.position.set(0, 0.095, 0);
    g.add(net);
    add(new BoxGeometry(TABLE.netHalfWidth * 2 - 0.15, 0.012, 0.02), ink, 0, 0.17, 0);
    for (const x of [-1, 1]) for (const z of [-1, 1]) add(new BoxGeometry(0.05, 0.5, 0.05), top, x * (TABLE.halfWidth - 0.12), -0.27, z * (TABLE.halfLength - 0.25));
    for (const m of marks) {
      const mat = m.fix ? verm : ink;
      const y = 0.024;
      add(new BoxGeometry(0.13, 0.004, 0.02), mat, m.x, y, m.z, Math.PI / 4);
      add(new BoxGeometry(0.13, 0.004, 0.02), mat, m.x, y, m.z, -Math.PI / 4);
    }
    return { g, mats: [top, ink, verm] };
  }, [marks]);
  useEffect(
    () => () => {
      built.g.traverse((o) => (o as Mesh).geometry?.dispose());
      built.mats.forEach((m) => m.dispose());
    },
    [built],
  );
  return <primitive object={built.g} />;
}

const MARKS = [
  { x: -0.35, z: -0.85 },
  { x: -0.1, z: -1.0 },
  { x: 0.25, z: -0.95 },
  { x: 0.4, z: -0.7 },
  { x: -0.45, z: -0.6 },
  { x: 0.1, z: -1.12 },
  { x: -0.2, z: -0.72 },
  { x: 0.32, z: -1.1 },
  { x: 0.05, z: -1.62, fix: true },
  { x: 0.42, z: -1.55, fix: true },
  { x: -0.3, z: -1.68, fix: true },
];

/** 5b. Post-match diagnostics as a codex study: top-down table with landing marks, a protractor and one takeaway. */
export function TestDiagnostics() {
  const board = useBoard();
  const hand = useRef<HandHandle>(null);
  const deep = new Vector3(-0.1, 0.03, -0.9);
  const long = new Vector3(0.05, 0.03, -1.62);
  board.set('deep', (o) => o.copy(deep)).set('long', (o) => o.copy(long)).set('face', onHand(hand, 'index:1'));
  const notes: LeaderNote[] = [
    { id: 'deep', n: 1, side: 'left', top: 60, width: 250, title: '8 of 11 landed deep', body: 'Your forehand already finds the back half.' },
    { id: 'long', n: 2, side: 'right', top: 60, width: 250, tone: 'fix', title: '3 went long', body: 'Every one with the face open.' },
    { id: 'face', n: 3, side: 'left', top: 470, width: 250, title: 'Face 9 degrees open', body: 'At contact, on the long balls.' },
  ];
  return (
    <Frame world="codex" active="learner" title="After the match" sub="You 2 rounds, the bot 1" aside={null}>
      <div className="dz-body">
        <section className="dz-stage dz-stage--plate" aria-label="Diagnostics">
          <SceneCanvas world="codex" position={[0.7, 6.0, 4.3]} target={[0, -0.1, 0.05]} board={board} codex={{ groundY: -0.55, sheet: { cx: 0, cz: 0, w: 6.4, d: 6.2 }, circle: 0 }} label="A sketched table tennis table seen from above with eleven inked landing marks, three of them long in red, and the learner's sketched hand with a racket at the near end">
            <SketchTable marks={MARKS} />
            <Hand ref={hand} style="sketch" side="right" scale={0.36} position={[0.55, 0.42, 1.95]} getFrame={play(SWING, 0.55)}>
              <Racket rubber="#8C4A2E" />
            </Hand>
          </SceneCanvas>
          <Leaders board={board} notes={notes} world="codex" />
        </section>
        <aside className="dz-panel" aria-label="Takeaway">
          <h2 className="dz-panel__h">One thing to change</h2>
          <figure className="dz-protractor" aria-label="Racket face protractor: 9 degrees open at contact, aim for 3 degrees closed">
            <svg viewBox="0 0 300 170" aria-hidden="true">
              <path d="M20 150 A130 130 0 0 1 280 150" fill="none" stroke="#3B2614" strokeWidth="2" />
              <path d="M20 150 H280" stroke="#3B2614" strokeWidth="2" />
              {Array.from({ length: 19 }, (_, i) => {
                const a = Math.PI - (i / 18) * Math.PI;
                const r1 = i % 3 === 0 ? 112 : 120;
                return <path key={i} d={`M${150 + Math.cos(a) * r1} ${150 - Math.sin(a) * r1} L${150 + Math.cos(a) * 130} ${150 - Math.sin(a) * 130}`} stroke="#3B2614" strokeWidth={i % 3 === 0 ? 2 : 1.2} />;
              })}
              <path d={`M150 150 L${150 + Math.cos(((90 - 9) * Math.PI) / 180) * 128} ${150 - Math.sin(((90 - 9) * Math.PI) / 180) * 128}`} stroke="#B2321B" strokeWidth="3.5" strokeLinecap="round" />
              <path d={`M150 150 L${150 + Math.cos(((90 + 3) * Math.PI) / 180) * 128} ${150 - Math.sin(((90 + 3) * Math.PI) / 180) * 128}`} stroke="#3B2614" strokeWidth="2.5" strokeDasharray="7 6" />
              <circle cx="150" cy="150" r="5" fill="#3B2614" />
            </svg>
            <figcaption>
              <span className="dz-fixtext">9 degrees open</span> now, <b>3 degrees closed</b> is the aim.
            </figcaption>
          </figure>
          <p className="dz-body-text">Close the racket face a little at contact. All three long balls came from an open face; the rest of your forehand held.</p>
          <div className="dz-panel__foot">
            <Primary k="Enter">Rematch</Primary>
            <button type="button" className="dz-link">
              Practise the swing step <Key>P</Key>
            </button>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

/** Static fallback for the board's live turntable: the sketch hand on its parchment sheet. */
export function Turntable() {
  return (
    <div className="dz dz--codex dz--bare" style={{ ['--dz-paper' as string]: `url(${getParchmentUrl({ width: 1600, height: 1000, tone: '#DCC59A', seed: 3, vignette: true })})` }}>
      <SceneCanvas world="codex" position={[2.9, 3.6, 4.3]} target={[0, -0.25, -0.65]} label="A sketched 3D hand on a parchment study sheet">
        <Hand style="sketch" side="right" position={[0, 0.1, 0]} getFrame={play(SCALE, 0.2)} />
      </SceneCanvas>
    </div>
  );
}
