import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  SphereGeometry,
  DoubleSide,
  Euler,
  Vector3,
} from 'three';
import type { GloveStreamHandle, HandFrame } from '../../../../api';
import { Hand, HandCanvas, Racket, RACKET_BLADE, RacketSketch } from '../../../../three';
import { toonGradient, type HandStyle } from '../../../../three/materials';
import { synthFrame } from '../../../../three/motion';
import { TABLE } from './ball';
import { PADDLE_Z, type RallyGame } from './rally';

/** Hand size on the court: a little larger than life so the grip reads from the back of the room. */
const HAND_SCALE = 0.2;
/**
 * How the near player's right hand turns, seen from behind them: the blade stands up and to the left of the hand, facing
 * the net, and the hand and wrist sit below and to the right of it, clear of the ball's path. The blade lies parallel to
 * the palm (RACKET_GRIP), so the palm faces the net as in a forehand. Derived from the racket's pose so the blade keeps
 * the same place on court whatever the grip: re-derive it if RACKET_GRIP turns. The far player's left hand is the mirror
 * image, turned round.
 */
const TURN = { pitch: -0.211, yaw: 1.646, roll: -1.66 };
const TURN_A = new Euler(TURN.pitch, TURN.yaw, TURN.roll, 'YXZ');
const TURN_B = new Euler(TURN.pitch, Math.PI - TURN.yaw, -TURN.roll, 'YXZ');
const LAPIS = '#1f2e78';
const LAPIS_LIGHT = '#2c3f9c';

function Table() {
  const built = useMemo(() => {
    const g = new Group();
    const top = new MeshToonMaterial({ color: LAPIS, gradientMap: toonGradient() });
    const edge = new MeshToonMaterial({ color: LAPIS_LIGHT, gradientMap: toonGradient() });
    const white = new MeshBasicMaterial({ color: '#f6f3ec' });
    const net = new MeshBasicMaterial({ color: '#f6f3ec', transparent: true, opacity: 0.38, side: DoubleSide });
    const leg = new MeshToonMaterial({ color: '#23252e', gradientMap: toonGradient() });
    const geos = [] as (BoxGeometry | PlaneGeometry | CylinderGeometry)[];
    const add = <T extends BoxGeometry | PlaneGeometry | CylinderGeometry>(geo: T, mat: MeshToonMaterial | MeshBasicMaterial, x: number, y: number, z: number): Mesh => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      geos.push(geo);
      return m;
    };
    const w = TABLE.halfWidth * 2;
    const l = TABLE.halfLength * 2;
    add(new BoxGeometry(w, 0.05, l), top, 0, TABLE.top - 0.025, 0);
    add(new BoxGeometry(w + 0.04, 0.02, l + 0.04), edge, 0, TABLE.top - 0.06, 0);
    const line = (gw: number, gl: number, x: number, z: number) => {
      const m = add(new PlaneGeometry(gw, gl), white, x, TABLE.top + 0.002, z);
      m.rotation.x = -Math.PI / 2;
    };
    line(w, 0.02, 0, l / 2 - 0.01);
    line(w, 0.02, 0, -l / 2 + 0.01);
    line(0.02, l, w / 2 - 0.01, 0);
    line(0.02, l, -w / 2 + 0.01, 0);
    line(0.012, l, 0, 0);
    for (const x of [-1, 1]) for (const z of [-1, 1]) add(new CylinderGeometry(0.035, 0.035, TABLE.top - 0.06, 10), leg, x * (TABLE.halfWidth - 0.1), (TABLE.top - 0.06) / 2, z * (TABLE.halfLength - 0.2));
    add(new PlaneGeometry(TABLE.netHalfWidth * 2 - 0.15, TABLE.netHeight), net, 0, TABLE.top + TABLE.netHeight / 2, 0);
    add(new BoxGeometry(TABLE.netHalfWidth * 2 - 0.15, 0.018, 0.012), white, 0, TABLE.top + TABLE.netHeight, 0);
    for (const x of [-1, 1]) add(new CylinderGeometry(0.014, 0.014, TABLE.netHeight + 0.04, 8), leg, x * (TABLE.netHalfWidth - 0.075), TABLE.top + TABLE.netHeight / 2, 0);
    return { g, geos, mats: [top, edge, white, net, leg] };
  }, []);
  useEffect(
    () => () => {
      built.geos.forEach((geo) => geo.dispose());
      built.mats.forEach((m) => m.dispose());
    },
    [built],
  );
  return <primitive object={built.g} />;
}

function BallMesh({ game }: { game: RallyGame }) {
  const ball = useRef<Mesh>(null);
  const shadow = useRef<Mesh>(null);
  const mats = useMemo(() => ({ ball: new MeshToonMaterial({ color: '#f4f1e8', gradientMap: toonGradient() }), shadow: new MeshBasicMaterial({ color: '#10142a', transparent: true, opacity: 0.4, depthWrite: false }) }), []);
  const geos = useMemo(() => ({ ball: new SphereGeometry(0.052, 20, 14), shadow: new CircleGeometry(0.05, 20) }), []);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      Object.values(geos).forEach((g) => g.dispose());
    },
    [mats, geos],
  );
  useFrame(() => {
    const b = game.ball;
    ball.current?.position.set(b.p.x, b.p.y, b.p.z);
    if (ball.current) ball.current.visible = game.phase !== 'match';
    const s = shadow.current;
    if (s) {
      const onTable = Math.abs(b.p.x) < TABLE.halfWidth && Math.abs(b.p.z) < TABLE.halfLength && b.p.y > TABLE.top;
      s.visible = onTable;
      s.position.set(b.p.x, TABLE.top + 0.004, b.p.z);
      s.scale.setScalar(1 + (b.p.y - TABLE.top) * 0.4);
    }
  });
  return (
    <>
      <mesh ref={ball} geometry={geos.ball} material={mats.ball} />
      <mesh ref={shadow} geometry={geos.shadow} material={mats.shadow} rotation={[-Math.PI / 2, 0, 0]} />
    </>
  );
}

interface PlayerHandProps {
  game: RallyGame;
  /** The live gloves that pose a player's hand; absent for the bot, whose robot hand holds `frame`. */
  gloves?: GloveStreamHandle;
  frame?: HandFrame;
  who: 'a' | 'b';
  side: 'left' | 'right';
  style?: HandStyle;
  /** Draw the solid racket; otherwise its chalk outline marks where the blade is. */
  showProp: boolean;
}

/** The bot's robot hand closes on its racket in a shakehand grip and holds it there. */
const BOT_GRIP: HandFrame = synthFrame({ preset: 'hold_pose', pose: { thumb: 0.62, index: 0.8, middle: 0.84, ring: 0.86, little: 0.88 } }, 0, 'left');

/**
 * A wooden hand holding a racket whose blade is kept on the ball; the glove supplies the wrist and finger pose. A marker
 * at the blade's centre moves with the hand, so wherever the wrist turns, the whole hand is shifted to put the blade
 * back on the paddle point.
 */
function PlayerHand({ game, gloves, frame, who, side, style = 'wood', showProp }: PlayerHandProps) {
  const group = useRef<Group>(null);
  const blade = useRef<Group>(null);
  const at = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const g = group.current;
    const b = blade.current;
    if (!g || !b) return;
    const p = game.paddle[who];
    b.getWorldPosition(at);
    g.position.x += p.x - at.x;
    g.position.y += p.y - at.y;
    g.position.z += (who === 'a' ? PADDLE_Z : -PADDLE_Z) - at.z;
  });
  return (
    <group ref={group}>
      <group rotation={who === 'a' ? TURN_A : TURN_B}>
        <Hand side={side} style={style} live={gloves?.latest} frame={frame} scale={HAND_SCALE} rotation={[0, 0, 0]}>
          {showProp ? <Racket /> : <RacketSketch weight={2.4} />}
          <group ref={blade} position={RACKET_BLADE} />
        </Hand>
      </group>
    </group>
  );
}

interface RallySceneProps {
  game: RallyGame;
  gloves: GloveStreamHandle;
  twoPlayer: boolean;
  /** Draw the solid racket in each hand, or a chalk outline of it when props are off. */
  showProp?: boolean;
}

/** The 3D court: lapis table with white lines and net, the ball, and the bot's robot hand or a second gloved player. */
export function RallyScene({ game, gloves, twoPlayer, showProp = true }: RallySceneProps) {
  return (
    <HandCanvas
      preset="single"
      label="A table tennis table seen from behind the near player"
      // From behind the near player, aimed a little above and beyond the middle of the table so the bot's robot hand at the
      // far end stays in the picture with yours (aimed at the origin it sat on the top edge). Orbit round that point.
      stage={{ showCircle: false, showShadow: false, groundY: 0, controls: 'orbit', cameraPosition: [0, 2.1, 3.9], target: [0, 0.5, -0.4] }}
    >
      <Table />
      <BallMesh game={game} />
      <PlayerHand game={game} gloves={gloves} who="a" side="right" showProp={showProp} />
      {twoPlayer ? (
        <PlayerHand game={game} gloves={gloves} who="b" side="left" showProp={showProp} />
      ) : (
        // The bot plays with a robot hand on its racket: always the solid racket, so its returns read from the near end.
        <PlayerHand game={game} frame={BOT_GRIP} who="b" side="left" style="robot" showProp />
      )}
    </HandCanvas>
  );
}
