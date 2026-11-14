import { useState } from 'react';
import { Euler, Quaternion } from 'three';
import { curlsToFlexion, Hand, HandCanvas, Keyboard, Racket, type CameraPreset, type HandStyle } from '../three';
import type { HandFrame, MotionSpec, Side } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Button, Tabs } from '../components/ui';
import { useGloveStream } from '../api';
import { MOTION_TEXT_MAX, motionProviderLine, useMotionFromText } from '../features/shared/useMotionFromText';

const styles: HandStyle[] = ['chalk', 'wood', 'ghost', 'shadow'];
const grip: MotionSpec = { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1800 };
const seq: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 700 };
const fist: MotionSpec = { preset: 'hold_pose', pose: { thumb: 0.7, index: 0.8, middle: 0.85, ring: 0.9, little: 0.9 } };
const open: MotionSpec = { preset: 'idle' };

/** A held frame from 0..1 curls (thumb first) and a wrist euler, mirrored for left hands like the synthesiser does. */
function held(curls: number[], rot: [number, number, number] = [0, 0, 0], side: Side = 'right'): HandFrame {
  const m = side === 'left' ? -1 : 1;
  const q = new Quaternion().setFromEuler(new Euler(rot[0], rot[1] * m, rot[2] * m));
  return { side, wrist_quat: [q.x, q.y, q.z, q.w], wrist_pos: null, flexion: curlsToFlexion(curls) };
}

/** Turns about the palm centre (the hand's own pivot is the wrist), so a turned hand stays framed. */
const PALM_Z = -0.85;
const turned = (yaw: number) => ({
  rotation: [0, yaw, 0] as [number, number, number],
  position: [-PALM_Z * Math.sin(yaw), 0, PALM_Z - PALM_Z * Math.cos(yaw)] as [number, number, number],
});
const SIDE = Math.PI / 2;
const FRONT = Math.PI * 0.82;
const FIST = [0.7, 0.8, 0.85, 0.9, 0.9];
const ANATOMY: { title: string; style: HandStyle; frame: HandFrame; yaw?: number; preset?: CameraPreset; pair?: boolean; racket?: boolean; marks?: boolean }[] = [
  { title: 'open, chalk, ring corrected, index in focus', style: 'chalk', frame: held([0, 0, 0, 0, 0]), marks: true },
  { title: 'relaxed, sketch, side', style: 'sketch', frame: held([-0.05, -0.1, -0.1, -0.1, -0.1]), yaw: SIDE },
  { title: 'fist, chalk, side', style: 'chalk', frame: held(FIST), yaw: SIDE },
  { title: 'fist, wood, front', style: 'wood', frame: held(FIST), yaw: FRONT },
  { title: 'pinch, chalk, front', style: 'chalk', frame: held([0.25, 0.3, 0.05, 0.05, 0.05]), yaw: FRONT },
  { title: 'point, wood, side', style: 'wood', frame: held([0.5, 0, 0.9, 0.95, 0.95]), yaw: SIDE },
  { title: 'palm up, sketch', style: 'sketch', frame: held([0.1, 0.15, 0.2, 0.25, 0.3], [0, 0, Math.PI]) },
  { title: 'two hands, ghost and chalk', style: 'chalk', frame: held([0.2, 0.3, 0.35, 0.4, 0.45]), preset: 'pair', pair: true },
  { title: 'racket grip, sketch', style: 'sketch', frame: held([0.62, 0.8, 0.84, 0.86, 0.88]), preset: 'racket', racket: true },
];

/** Held poses for checking bends, palm and knuckles without animation; ?tab=anatomy. */
function AnatomyGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(560px, 1fr))', gap: '1rem' }}>
      {ANATOMY.map((a) => (
        <Cell key={a.title} title={a.title} preset={a.preset}>
          {a.pair ? (
            <>
              <Hand style="chalk" side="left" frame={held([0.2, 0.3, 0.35, 0.4, 0.45], [0, 0, 0], 'left')} position={[-1.0, 0, 0]} />
              <Hand style="sketch" side="right" frame={a.frame} position={[1.0, 0, 0]} />
              <Hand style="ghost" side="right" frame={held([0.6, 0.7, 0.75, 0.8, 0.8])} position={[1.1, 0.08, -0.1]} />
            </>
          ) : (
            <Hand style={a.style} frame={a.frame} {...(a.yaw ? turned(a.yaw) : {})} fingerTint={a.marks ? { ring: '#B2321B' } : undefined} focusFinger={a.marks ? 'index' : null}>
              {a.racket && <Racket />}
            </Hand>
          )}
        </Cell>
      ))}
    </div>
  );
}

function Cell({ title, preset, cam, children }: { title: string; preset?: CameraPreset; cam?: [number, number, number]; children: React.ReactNode }) {
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ height: 520 }}>
        <HandCanvas preset={preset ?? 'single'} stage={cam ? { cameraPosition: cam, showShadow: false } : undefined}>{children}</HandCanvas>
      </div>
      <figcaption className="note">{title}</figcaption>
    </figure>
  );
}

/** Say a movement in words and watch the simulator hand perform it: text to MotionSpec, then set_motion over the glove socket. */
function DescribeLab() {
  const gloves = useGloveStream(true);
  const m = useMotionFromText('right');
  const apply = async () => {
    const r = await m.run();
    if (r) gloves.setMotion(r.motion);
  };
  return (
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 900 }}>
      <form
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <div className="field" style={{ flex: '1 1 20rem' }}>
          <label className="field__label" htmlFor="lab-describe">
            Describe a movement
          </label>
          <input id="lab-describe" className="field__control" value={m.text} maxLength={MOTION_TEXT_MAX} placeholder="show me a pinch, slower" onChange={(e) => m.setText(e.target.value)} />
        </div>
        <Button type="submit" disabled={m.busy || !m.text.trim()}>
          {m.busy ? 'Reading...' : 'Show me'}
        </Button>
      </form>
      {m.error && <p className="note" role="alert">{m.error}</p>}
      {m.result && !m.error && (
        <p className="note" role="status">
          {m.result.explanation} {motionProviderLine(m.result.provider)}
        </p>
      )}
      {gloves.status !== 'open' && <p className="note">The glove stream is not connected, so the hand cannot move yet.</p>}
      <div style={{ height: 520 }}>
        <HandCanvas preset="single">
          <Hand style="chalk" live={gloves.latest} motion={open} />
        </HandCanvas>
      </div>
    </div>
  );
}

/** Developer gallery of every hand style and prop at /lab. Handy for checking geometry and themes. */
export function HandLab() {
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') ?? 'styles');
  return (
    <>
      <PageHeader kicker="Studio notes" title="Hand lab" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'styles',
            label: 'Styles',
            content: (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1rem' }}>
                {styles.map((s) => (
                  <Cell key={s} title={s}>
                    <Hand style={s} motion={seq} showJoints={s === 'chalk'} showTrails={s === 'chalk'} />
                  </Cell>
                ))}
              </div>
            ),
          },
          {
            id: 'poses',
            label: 'Poses',
            content: (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1rem' }}>
                <Cell title="open, chalk"><Hand style="chalk" motion={open} /></Cell>
                <Cell title="fist, chalk"><Hand style="chalk" motion={fist} /></Cell>
                <Cell title="open, wood"><Hand style="wood" motion={open} /></Cell>
                <Cell title="fist, wood"><Hand style="wood" motion={fist} /></Cell>
              </div>
            ),
          },
          {
            id: 'grip',
            label: 'Grip',
            content: (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1rem' }}>
                {([[3.4, 1.4, 1.2], [1.2, 1.3, -2.6], [-2.8, 1.6, 1.0], [0.4, 3.6, 1.6]] as [number, number, number][]).map((c, i) => (
                  <Cell key={i} title={'grip camera ' + c.join(', ')} preset="racket" cam={c}>
                    <Hand style="chalk" motion={{ preset: 'hold_pose', pose: { thumb: 0.6, index: 0.7, middle: 0.85, ring: 0.9, little: 0.9 } }}>
                      <Racket />
                    </Hand>
                  </Cell>
                ))}
              </div>
            ),
          },
          {
            id: 'props',
            label: 'Props',
            content: (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1rem' }}>
                <Cell title="racket, chalk" preset="racket">
                  <Hand style="chalk" motion={grip}>
                    <Racket />
                  </Hand>
                </Cell>
                <Cell title="racket, wood" preset="racket">
                  <Hand style="wood" motion={grip}>
                    <Racket />
                  </Hand>
                </Cell>
                <Cell title="keyboard, chalk" preset="keyboard">
                  <Hand style="chalk" motion={seq} position={[0, 0.12, 0]} />
                  <Keyboard />
                </Cell>
                <Cell title="ghost over wood" preset="racket">
                  <Hand style="wood" motion={grip}>
                    <Racket />
                  </Hand>
                  <Hand style="ghost" motion={grip} position={[0, 0.05, -0.1]}>
                    <Racket />
                  </Hand>
                </Cell>
              </div>
            ),
          },
          { id: 'anatomy', label: 'Anatomy', content: <AnatomyGrid /> },
          { id: 'describe', label: 'Describe', content: <DescribeLab /> },
        ]}
      />
    </>
  );
}
