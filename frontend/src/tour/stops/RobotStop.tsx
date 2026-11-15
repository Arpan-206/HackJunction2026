import '../threeSetup';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Side } from '../../api/types';
import { twinCamera, TWIN_TARGET, DESIGN_ASPECT } from '../../features/shared/robot/twinFraming';
import { handAt } from '../../features/shared/playback';
import { limitsOf, retargetHand } from '../../mock/robot';
import { Hand, type HandHandle } from '../../three/Hand';
import { RobotHand, useRobotModel, type RobotHandHandle } from '../../three/robot/RobotHand';
import { RobotStrings } from '../../three/robot/RobotStrings';
import { HandCanvas } from '../../three/Stage';
import { useLoopClock, type LoopClock } from '../clock';
import type { TourTake } from '../data';
import { StageFrame } from '../StageFrame';
import { PlayButton, useTake } from './shared';

/** Layout as the app's robot twin (features/shared/robot/RobotTwin.tsx): human hand left, robot right, both lifted. */
const HUMAN_X = -1.35;
const ROBOT_X = 1.35;
const LIFT = 0.6;
const robotRoll = (side: Side): [number, number, number] => [0, 0, side === 'right' ? -Math.PI / 2 : Math.PI / 2];

const VIDEO = 'media/policy_demo.mp4';
const POSTER = 'policy_demo_poster.jpg';

export default function RobotStop() {
  const take = useTake('robot');
  return (
    <section className="tour-stop">
      <p className="tour-lead">
        Geppetto drives a robot hand from the same recording. The chalk hand plays a real take: the five-finger piano scale, every finger in turn. Strings run from its fingertips to a Unitree
        Dex3-1 robot hand, which follows through the app's own retarget.
      </p>
      {take ? <RobotStage take={take} /> : <p className="tour-loading">Loading the take...</p>}
      <p className="tour-small">
        The Dex3-1 has a thumb and two fingers, seven joints in all. The ring and little fingers have no robot finger, so their strings hang loose.
      </p>

      <h3 className="tour-h3">Recovering from a push</h3>
      <p>
        A small policy we trained performs a held-out expert take on a simulated Dex3-1. Here a push knocks the fingers off course. Left: plain replay of the recorded
        targets. Right: the policy, which reads the hand and sends its own commands.
      </p>
      <video className="tour-video" controls preload="none" playsInline muted poster={POSTER} width={1088} height={544}>
        <source src={VIDEO} type="video/mp4" />
      </video>
      <p className="tour-small">
        Error over whole held-out takes: 2.13 degrees for the policy against 6.12 for plain replay. With pushes: 3.78 against 7.25. Measured over 1.44 million
        evaluation rollouts. Limits: simulation only, no real robot hand, and no contact with objects.
      </p>
    </section>
  );
}

function useAspect(ref: RefObject<HTMLElement | null>): number {
  const [aspect, setAspect] = useState(DESIGN_ASPECT);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setAspect(Math.round((width / height) * 20) / 20);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return aspect;
}

function RobotStage({ take }: { take: TourTake }) {
  const clock = useLoopClock(take.duration);
  return (
    <>
      <StageFrame text="The chalk hand plays a five-finger scale. The Dex3-1 robot hand beside it bends its thumb and two fingers to follow, joined by strings.">
        <Twin take={take} clock={clock} />
      </StageFrame>
      <div className="tour-controls">
        <PlayButton clock={clock} />
        <span className="tour-time">
          {clock.shown.toFixed(1)} s of {take.duration.toFixed(1)} s
        </span>
      </div>
    </>
  );
}

function Twin({ take, clock }: { take: TourTake; clock: LoopClock }) {
  const humanRef = useRef<HandHandle>(null);
  const robotRef = useRef<RobotHandHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const camera = twinCamera(useAspect(box));
  const { model } = useRobotModel(take.side);
  const limits = useMemo(() => (model ? limitsOf(model) : null), [model]);
  const getQ = useMemo(
    () => () => {
      const hand = handAt(take.frames, clock.now(), take.side);
      return hand && limits ? retargetHand(hand, limits).q : null;
    },
    [take, clock, limits],
  );
  return (
    <div ref={box} className="rb-twin tour-twin">
      <HandCanvas preset="pair" stage={{ cameraPosition: camera, target: TWIN_TARGET, circleCenter: [0, -0.5], decor: false }} label="The recorded hand beside the Dex3-1 robot hand it drives">
        <Hand ref={humanRef} side={take.side} style="chalk" getFrame={() => handAt(take.frames, clock.now(), take.side)} position={[HUMAN_X, LIFT, 0]} centred={false} />
        <RobotHand ref={robotRef} side={take.side} getQ={getQ} position={[ROBOT_X, LIFT, 0]} rotation={robotRoll(take.side)} />
        <RobotStrings human={humanRef} robot={robotRef} />
      </HandCanvas>
      <div className="rb-twin__caps" aria-hidden="true">
        <span className="rb-twin__cap">The expert's take</span>
        <span className="rb-twin__cap rb-twin__cap--robot">Dex3-1</span>
      </div>
    </div>
  );
}
