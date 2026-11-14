import { useEffect, useRef, useState } from 'react';
import type { MotionSpec, Prop, Side } from '../../../api';
import { Hand, HandPreview, Racket } from '../../../three';
import { usePlayback } from '../../shared/playback';
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

function Inner({ motion, recordingId, side, prop, label }: GuideHandProps) {
  const { recording } = useRecording(recordingId);
  const pb = usePlayback(recording?.frames ?? null);
  const s = side ?? 'right';
  return (
    <HandPreview className="mst-guide__view" label={label}>
      <Hand side={s} style="chalk" motion={motion ?? { preset: 'idle' }} getFrame={() => pb.getFrame(s)}>
        {prop === 'racket' && <Racket />}
      </Hand>
    </HandPreview>
  );
}

/**
 * A small animated chalk hand drawn by the shared preview canvas (see PreviewHost), so any number of previews
 * cost one WebGL context. The view mounts the first time the element nears the viewport and then stays, so there is no flicker.
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
