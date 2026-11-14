import { useMemo, useState, type ReactNode } from 'react';
import { FINGERS, type Finger, type MotionSpec } from '../../api/types';
import { SelectControl, SliderControl, TextControl } from '../controls';

export const PRESETS = ['finger_sequence', 'grip_and_swing', 'pinch', 'hold_pose', 'idle'] as const;
type PresetId = (typeof PRESETS)[number];
const PINCH = ['index', 'middle', 'index and middle'] as const;

/** Parses "1, 2, 3" into finger numbers 1 to 5, ignoring anything else. */
function parseSequence(text: string): (1 | 2 | 3 | 4 | 5)[] {
  return text
    .split(/[^1-5]+/)
    .filter(Boolean)
    .map((d) => Number(d) as 1 | 2 | 3 | 4 | 5);
}

/** Preset selector plus the parameters that preset exposes, producing a MotionSpec. Controls are returned as nodes. */
export function useMotionState(initial: PresetId = 'finger_sequence'): { spec: MotionSpec; controls: ReactNode } {
  const [preset, setPreset] = useState<PresetId>(initial);
  const [beat, setBeat] = useState(620);
  const [sequence, setSequence] = useState('1, 2, 3, 4, 5');
  const [grip, setGrip] = useState<'shakehand' | 'penhold'>('shakehand');
  const [swing, setSwing] = useState<'forehand' | 'backhand'>('forehand');
  const [pinch, setPinch] = useState<(typeof PINCH)[number]>('index');
  const [pose, setPose] = useState<Record<Finger, number>>({ thumb: 0.1, index: 0.15, middle: 0.15, ring: 0.15, little: 0.15 });

  const spec = useMemo<MotionSpec>(() => {
    switch (preset) {
      case 'finger_sequence':
        return { preset, sequence: parseSequence(sequence).length ? parseSequence(sequence) : [1, 2, 3, 4, 5], beat_ms: beat };
      case 'grip_and_swing':
        return { preset, grip, swing, beat_ms: beat };
      case 'pinch':
        return { preset, fingers: pinch === 'index' ? [2] : pinch === 'middle' ? [3] : [2, 3], beat_ms: beat };
      case 'hold_pose':
        return { preset, pose };
      default:
        return { preset: 'idle' };
    }
  }, [preset, beat, sequence, grip, swing, pinch, pose]);

  const controls = (
    <>
      <SelectControl label="Motion preset" value={preset} options={PRESETS} onChange={setPreset} />
      {(preset === 'finger_sequence' || preset === 'grip_and_swing' || preset === 'pinch') && (
        <SliderControl label="Beat (beat_ms)" value={beat} min={200} max={3000} step={10} onChange={setBeat} format={(v) => `${v} ms`} />
      )}
      {preset === 'finger_sequence' && <TextControl label="Sequence (fingers 1 to 5)" value={sequence} onChange={setSequence} />}
      {preset === 'grip_and_swing' && (
        <>
          <SelectControl label="Grip" value={grip} options={['shakehand', 'penhold']} onChange={setGrip} />
          <SelectControl label="Swing" value={swing} options={['forehand', 'backhand']} onChange={setSwing} />
        </>
      )}
      {preset === 'pinch' && <SelectControl label="Pinching fingers" value={pinch} options={PINCH} onChange={setPinch} />}
      {preset === 'hold_pose' &&
        FINGERS.map((f) => <SliderControl key={f} label={`${f} curl`} value={pose[f]} min={-0.2} max={1} step={0.05} onChange={(v) => setPose((p) => ({ ...p, [f]: v }))} format={(v) => v.toFixed(2)} />)}
    </>
  );
  return { spec, controls };
}
