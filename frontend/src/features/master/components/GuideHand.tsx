import { useEffect, useMemo, useRef, useState } from 'react';
import type { MotionSpec, Prop, Side } from '../../../api';
import { Hand, HandCanvas, HandStill, Racket } from '../../../three';
import { synthFrame } from '../../../three/motion';
import { framesDuration, handAt, usePlayback } from '../../shared/playback';
import { useRecording } from '../hooks/useRecording';

interface GuideHandProps {
  /** Mock guide motion, played locally with the preview synthesiser. */
  motion?: MotionSpec | null;
  /** When set and loadable, the master's recorded take plays instead of the mock motion. */
  recordingId?: string | null;
  side?: Side;
  prop?: Prop;
  label: string;
}

/** Where in the motion (seconds, or the share of a recorded take) the guide's resting picture is taken. */
const STILL_T = 0.8;
const STILL_SHARE = 0.4;

/** A live hand sits in a canvas of its own inside its box: plain stage, fixed camera. */
const LIVE_STAGE = { decor: false, showGrid: false, controls: 'none' } as const;

function Inner({ motion, recordingId, side, prop, label }: GuideHandProps) {
  const { recording } = useRecording(recordingId);
  const frames = recording?.frames ?? null;
  // Only getFrame is read here, so the position tick would only re-render the guide.
  const pb = usePlayback(frames, { tick: false });
  const s = side ?? 'right';
  const [live, setLive] = useState(false);
  const still = useMemo(() => {
    if (frames && frames.length > 1) return handAt(frames, framesDuration(frames) * STILL_SHARE, s);
    return synthFrame(motion ?? { preset: 'idle' }, STILL_T, s);
  }, [frames, motion, s]);
  const stillId = `guide:${frames ? `take:${recordingId}` : JSON.stringify(motion ?? 'idle')}:${s}:${prop ?? 'none'}:chalk`;
  return (
    <div className="mst-guide__box" onPointerEnter={() => setLive(true)} onPointerLeave={() => setLive(false)}>
      <HandStill className="mst-guide__view" label={label} stillId={stillId}>
        <Hand side={s} style="chalk" frame={still} smoothing={false}>
          {prop === 'racket' && <Racket />}
        </Hand>
      </HandStill>
      {live && (
        <div className="mst-guide__live" aria-hidden="true">
          <HandCanvas preset="closeup" stage={LIVE_STAGE}>
            <Hand side={s} style="chalk" motion={motion ?? { preset: 'idle' }} getFrame={() => pb.getFrame(s)}>
              {prop === 'racket' && <Racket />}
            </Hand>
          </HandCanvas>
        </div>
      )}
    </div>
  );
}

/**
 * A small chalk hand in a fixed pose, drawn once to a picture (see HandStill), so any number of guides are plain
 * images that scroll with the page. While the pointer is over it the hand moves: a live canvas of its own opens inside
 * the box and closes again. The view mounts the first time the element nears the viewport and then stays.
 */
export function GuideHand({ label, ...rest }: GuideHandProps) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={box} className="mst-guide">
      {visible && <Inner label={label} {...rest} />}
    </div>
  );
}
