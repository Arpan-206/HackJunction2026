import { useRef, useState } from 'react';
import { Hand, HandCanvas, Keyboard, Racket, type CameraPreset, type HandHandle } from '../../three';
import { expr, toJsx } from '../jsx';
import { ColourControl, SectionLayout, SelectControl, SliderControl, ToggleControl } from '../controls';
import { useMotionState } from './useMotionState';

const CAMERAS: CameraPreset[] = ['single', 'closeup', 'pair', 'racket', 'keyboard'];
const PROPS = ['none', 'racket', 'keyboard'] as const;

/** Stage presets and the held and table props. */
export default function StageSection() {
  const [camera, setCamera] = useState<CameraPreset>('racket');
  const [prop, setProp] = useState<(typeof PROPS)[number]>('racket');
  const [grid, setGrid] = useState(true);
  const [circle, setCircle] = useState(true);
  const [shadow, setShadow] = useState(true);
  const [orbit, setOrbit] = useState(true);
  const [sway, setSway] = useState(0);
  const [rubber, setRubber] = useState('#7a2a22');
  const [keys, setKeys] = useState(11);
  const [activeKey, setActiveKey] = useState(-1);
  const { spec, controls } = useMotionState('grip_and_swing');
  const hand = useRef<HandHandle>(null);

  const stage = { showGrid: grid, showCircle: circle, showShadow: shadow, controls: orbit ? ('orbit' as const) : ('none' as const) };
  const canvasJsx = toJsx('HandCanvas', { preset: camera, stage, sway: sway || undefined });
  const handJsx = toJsx('Hand', { style: 'wood', motion: spec }, prop === 'racket' ? toJsx('Racket', { rubber }) : undefined);
  const keyJsx = prop === 'keyboard' ? toJsx('Keyboard', { keys, activeKey: activeKey < 0 ? undefined : activeKey, handRef: expr('hand') }) : '';

  return (
    <SectionLayout
      title="Stage and props"
      blurb="Camera presets with the construction circle, grid and contact shadow. The racket is held in hand space; the keyboard lights the key under the lowest fingertip."
      canvas
      jsx={[canvasJsx, handJsx, keyJsx].filter(Boolean).join('\n')}
      specimen={
        <HandCanvas key={`${camera}-${orbit}`} preset={camera} sway={sway} stage={stage} label={`A wooden hand with ${prop === 'none' ? 'no prop' : `a ${prop}`}`}>
          <Hand ref={hand} style="wood" motion={spec}>
            {prop === 'racket' && <Racket rubber={rubber} />}
          </Hand>
          {prop === 'keyboard' && <Keyboard keys={keys} handRef={hand} activeKey={activeKey < 0 ? null : activeKey} />}
        </HandCanvas>
      }
      controls={
        <>
          <SelectControl label="Camera preset" value={camera} options={CAMERAS} onChange={setCamera} />
          <SelectControl label="Prop" value={prop} options={PROPS} onChange={setProp} />
          {prop === 'racket' && <ColourControl label="Rubber colour" value={rubber} onChange={setRubber} />}
          {prop === 'keyboard' && (
            <>
              <SliderControl label="Keys" value={keys} min={5} max={14} onChange={setKeys} />
              <SliderControl label="Active key (-1 tracks the finger)" value={activeKey} min={-1} max={keys - 1} onChange={setActiveKey} />
            </>
          )}
          {controls}
          <ToggleControl label="Grid" checked={grid} onChange={setGrid} />
          <ToggleControl label="Construction circle" checked={circle} onChange={setCircle} />
          <ToggleControl label="Contact shadow" checked={shadow} onChange={setShadow} />
          <ToggleControl label="Orbit controls" checked={orbit} onChange={setOrbit} />
          <SliderControl label="Turntable sway (rad)" value={sway} min={0} max={0.8} step={0.05} onChange={setSway} format={(v) => v.toFixed(2)} />
        </>
      }
    />
  );
}
