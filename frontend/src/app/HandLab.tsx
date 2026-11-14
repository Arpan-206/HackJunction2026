import { useState } from 'react';
import { Hand, HandCanvas, Keyboard, Racket, type CameraPreset, type HandStyle } from '../three';
import type { MotionSpec } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Button, Tabs } from '../components/ui';
import { useGloveStream } from '../api';
import { MOTION_TEXT_MAX, motionProviderLine, useMotionFromText } from '../features/shared/useMotionFromText';

const styles: HandStyle[] = ['chalk', 'wood', 'ghost', 'shadow'];
const grip: MotionSpec = { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1800 };
const seq: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 700 };
const fist: MotionSpec = { preset: 'hold_pose', pose: { thumb: 0.7, index: 0.8, middle: 0.85, ring: 0.9, little: 0.9 } };
const open: MotionSpec = { preset: 'idle' };

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
          { id: 'describe', label: 'Describe', content: <DescribeLab /> },
        ]}
      />
    </>
  );
}
