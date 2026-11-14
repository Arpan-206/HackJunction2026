import { useState } from 'react';
import { FINGERS, type Finger, type Side } from '../../api/types';
import { Hand, HandCanvas, type CameraPreset, type HandStyle } from '../../three';
import { toJsx } from '../jsx';
import { ColourControl, SectionLayout, SelectControl, SliderControl, ToggleControl } from '../controls';
import { useMotionState } from './useMotionState';

const STYLES: HandStyle[] = ['chalk', 'wood', 'ghost', 'shadow'];
const CAMERAS: CameraPreset[] = ['single', 'closeup', 'pair', 'racket', 'keyboard'];
const FOCUS = ['none', ...FINGERS] as const;

/** The articulated hand with every public prop on a control. */
export default function HandSection() {
  const [side, setSide] = useState<Side>('right');
  const [style, setStyle] = useState<HandStyle>('wood');
  const [camera, setCamera] = useState<CameraPreset>('single');
  const [smoothOff, setSmoothOff] = useState(false);
  const [tau, setTau] = useState(0.045);
  const [joints, setJoints] = useState(false);
  const [trails, setTrails] = useState(false);
  const [focus, setFocus] = useState<(typeof FOCUS)[number]>('none');
  const [useTint, setUseTint] = useState(false);
  const [tint, setTint] = useState('#b2321b');
  const [opacity, setOpacity] = useState(1);
  const [scale, setScale] = useState(1);
  const { spec, controls } = useMotionState();
  const focusFinger: Finger | null = focus === 'none' ? null : focus;
  const smoothing = smoothOff ? false : tau;

  const props = {
    side: side === 'right' ? undefined : side,
    style: style === 'chalk' ? undefined : style,
    motion: spec,
    smoothing: smoothing === 0.045 ? undefined : smoothing,
    tint: useTint ? tint : undefined,
    focusFinger: focusFinger ?? undefined,
    opacity: opacity === 1 ? undefined : opacity,
    scale: scale === 1 ? undefined : scale,
    showJoints: joints || undefined,
    showTrails: trails || undefined,
  };

  return (
    <SectionLayout
      title="Hand"
      blurb="The articulated hand. Drag to orbit. Ghost and shadow only show their opacity against the stage."
      canvas
      jsx={toJsx('Hand', props)}
      specimen={
        <HandCanvas key={camera} preset={camera} label={`A ${style} ${side} hand playing the ${spec.preset} motion`}>
          <Hand
            side={side}
            style={style}
            motion={spec}
            smoothing={smoothing}
            tint={useTint ? tint : undefined}
            focusFinger={focusFinger}
            opacity={opacity}
            scale={scale}
            showJoints={joints}
            showTrails={trails}
          />
        </HandCanvas>
      }
      controls={
        <>
          <SelectControl label="Side" value={side} options={['right', 'left']} onChange={setSide} />
          <SelectControl label="Style" value={style} options={STYLES} onChange={setStyle} />
          {controls}
          <ToggleControl label="Smoothing off" checked={smoothOff} onChange={setSmoothOff} />
          {!smoothOff && <SliderControl label="Smoothing tau" value={tau} min={0.005} max={0.4} step={0.005} onChange={setTau} format={(v) => `${v.toFixed(3)} s`} />}
          <ToggleControl label="Joint rings" checked={joints} onChange={setJoints} />
          <ToggleControl label="Fingertip trails" checked={trails} onChange={setTrails} />
          <SelectControl label="Focus finger (gold)" value={focus} options={FOCUS} onChange={setFocus} />
          <ToggleControl label="Override tint" checked={useTint} onChange={setUseTint} />
          {useTint && <ColourControl label="Tint" value={tint} onChange={setTint} />}
          <SliderControl label="Opacity (ghost, shadow)" value={opacity} min={0.1} max={1} step={0.05} onChange={setOpacity} format={(v) => v.toFixed(2)} />
          <SliderControl label="Scale" value={scale} min={0.5} max={1.6} step={0.05} onChange={setScale} format={(v) => v.toFixed(2)} />
          <SelectControl label="Camera preset" value={camera} options={CAMERAS} onChange={setCamera} />
        </>
      }
    />
  );
}
