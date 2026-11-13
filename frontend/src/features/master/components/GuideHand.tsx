import { useEffect, useRef, useState } from 'react';
import type { MotionSpec, Prop, Side } from '../../../api';
import { Hand, HandCanvas, Racket } from '../../../three';
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

function Inner({ motion, recordingId, side, prop }: Omit<GuideHandProps, 'label'>) {
  const { recording } = useRecording(recordingId);
  const pb = usePlayback(recording?.frames ?? null);
  const s = side ?? 'right';
  return (
    <HandCanvas preset="closeup" stage={{ controls: 'none', showGrid: false }}>
      <Hand side={s} style="chalk" motion={motion ?? { preset: 'idle' }} getFrame={() => pb.getFrame(s)}>
        {prop === 'racket' && <Racket />}
      </Hand>
    </HandCanvas>
  );
}

/**
 * A small animated chalk hand. The canvas mounts only while the element is on screen, so a long list of
 * previews never exhausts the browser's WebGL contexts.
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
    const io = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)), { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={box} className="mst-guide" role="img" aria-label={label}>
      {visible && <Inner {...rest} />}
    </div>
  );
}
