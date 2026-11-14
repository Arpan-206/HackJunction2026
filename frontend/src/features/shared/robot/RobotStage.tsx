import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Finger, GloveFrame, HandFrame, Side } from '../../../api/types';
import { Hand, HandCanvas, PRESETS, type HandHandle } from '../../../three';
import type { HandStyle } from '../../../three/materials';
import { MarionetteStrings, RobotHand, robotFingers, type RobotHandHandle, type RobotModels } from '../../../three/robot';

export interface RobotStageProps {
  models: RobotModels;
  side: Side;
  /** The human hand: a live glove ref, or a function of scene time (a lesson replay). */
  live?: RefObject<GloveFrame | null>;
  getFrame?: (t: number) => HandFrame | null;
  humanStyle?: HandStyle;
  /** Robot joint targets: the stream's latest message, or a function of scene time. */
  q?: RefObject<{ q: Record<string, number> } | null>;
  getQ?: (t: number) => Record<string, number> | null;
  /** Read every frame: strings taut while the robot follows. */
  taut: RefObject<boolean>;
  /** Hide the strings when the hand shown is not the one driving the robot. */
  stringsHidden?: boolean;
  label: string;
  className?: string;
}

/**
 * The human hand and the robot twin side by side on the bottega stage, joined by marionette strings. Always 3D. The
 * human hand sits on the left, the robot on the right, both palm down with the fingers away from the camera.
 */
/** Camera distance factor for a stage of this width-to-height ratio: both hands stay in frame on a narrow phone. */
export function cameraFactor(aspect: number): number {
  return Math.min(2.4, Math.max(1, 1.9 / Math.max(aspect, 0.3)));
}

export function RobotStage({ models, side, live, getFrame, humanStyle = 'chalk', q, getQ, taut, stringsHidden, label, className }: RobotStageProps) {
  const box = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setAspect(r.width / r.height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const human = useRef<HandHandle>(null);
  const robot = useRef<RobotHandHandle>(null);
  const model = models[side];
  const fingers = useMemo(() => robotFingers(model), [model]);
  const loose = useMemo(() => (['thumb', 'index', 'middle', 'ring', 'little'] as Finger[]).filter((f) => !fingers.includes(f)), [fingers]);
  // The camera is set when the canvas mounts, so the canvas waits for the first measurement and remounts when the
  // framing bucket changes (a phone turned, a window resized across the breakpoint).
  const k = aspect === null ? null : Math.round(cameraFactor(aspect) * 4) / 4;
  const cam = k === null ? null : (PRESETS.pair.position.map((v) => v * k) as [number, number, number]);
  return (
    <div ref={box} className={className} style={{ width: '100%', height: '100%' }}>
      {cam && (
        <HandCanvas key={k} preset="pair" label={label} stage={{ target: [0, -0.2, -0.7], cameraPosition: cam }}>
          <Hand ref={human} side={side} style={humanStyle} live={live} getFrame={getFrame} position={[-1.45, 0, 0]} />
          {/* Turned on its side, palm towards the camera, so its curling fingers are seen in profile rather than hidden under the palm. */}
          <RobotHand ref={robot} model={model} q={q} getQ={getQ} position={[1.2, 0, 0.1]} rotation={[0, 0, side === 'left' ? -Math.PI / 2 : Math.PI / 2]} scale={1.12} />
          <MarionetteStrings human={human} robot={robot} fingers={fingers} loose={loose} taut={taut} hidden={stringsHidden} />
        </HandCanvas>
      )}
    </div>
  );
}
