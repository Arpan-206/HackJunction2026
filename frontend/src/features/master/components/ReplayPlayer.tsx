import { useMemo, useState } from 'react';
import type { GloveFrame, Hands, Prop, Side } from '../../../api';
import { Button } from '../../../components/ui';
import { Hand, HandCanvas, PAIR_STAGE, pairPosition, Racket } from '../../../three';
import { framesDuration, usePlayback } from '../../shared/playback';
import { useRecording } from '../hooks/useRecording';
import { FingerLanes } from './FingerLanes';

export interface ReplayItem {
  id: string;
  label: string;
}

interface ReplayPlayerProps {
  /** One take, or two to compare side by side. */
  items: ReplayItem[];
  side?: Side;
  /** A two-handed take ('both') replays both hands side by side; compare mode always shows one hand per take. */
  hands?: Hands;
  /** Pass 'none' unless the session's prop switch is on. */
  prop?: Prop;
  onClose?: () => void;
}

const RATES = [0.25, 0.5, 1];

/** Holds the last pose so a shorter take waits for the longer one and both loop together. */
function padTo(frames: GloveFrame[] | undefined, duration: number): GloveFrame[] | null {
  if (!frames?.length) return null;
  const last = frames[frames.length - 1];
  const end = frames[0].t + duration;
  return last.t < end ? [...frames, { ...last, t: end }] : frames;
}

/**
 * Plays one or two recorded takes on chalk hands with play/pause, a scrubber, speed and loop controls.
 * Two takes share one clock so differences are easy to see.
 */
export function ReplayPlayer({ items, side = 'right', hands, prop = 'none', onClose }: ReplayPlayerProps) {
  const a = useRecording(items[0]?.id);
  const b = useRecording(items[1]?.id);
  const [loop, setLoop] = useState(true);
  const duration = Math.max(a.recording ? framesDuration(a.recording.frames) : 0, b.recording ? framesDuration(b.recording.frames) : 0);
  const framesA = useMemo(() => padTo(a.recording?.frames, duration), [a.recording, duration]);
  const framesB = useMemo(() => padTo(b.recording?.frames, duration), [b.recording, duration]);
  const pa = usePlayback(framesA, { loop });
  const pb = usePlayback(framesB, { loop });
  const compare = items.length === 2;
  const both = !compare && hands === 'both';
  const loading = a.loading || b.loading;
  const failed = a.error ?? b.error;

  const apply = (fn: (p: typeof pa) => void) => {
    fn(pa);
    if (compare) fn(pb);
  };

  return (
    <section className="mst-replay" aria-label={compare ? 'Compare two takes' : 'Replay take'}>
      <div className="mst-replay__stage">
        <HandCanvas preset={compare || both ? 'pair' : prop === 'racket' ? 'racket' : 'single'} stage={compare || both ? PAIR_STAGE : undefined} label="Replay of your recorded take">
          {both ? (
            (['left', 'right'] as const).map((s) => (
              <Hand key={s} side={s} style="chalk" getFrame={() => pa.getFrame(s)} position={pairPosition(s)}>
                {prop === 'racket' && s === 'right' && <Racket />}
              </Hand>
            ))
          ) : (
            <Hand side={side} style="chalk" getFrame={() => pa.getFrame(side)} position={compare ? pairPosition('left') : [0, 0, 0]}>
              {prop === 'racket' && <Racket />}
            </Hand>
          )}
          {compare && <Hand side={side} style="chalk" getFrame={() => pb.getFrame(side)} position={pairPosition('right')} />}
        </HandCanvas>
        <div className="mst-stage__overlay">
          {items.map((it) => (
            <span key={it.id} className="mst-stage__tag">
              {it.label}
            </span>
          ))}
          {loading && <span className="note">Fetching the take...</span>}
        </div>
      </div>

      {failed && (
        <p className="mst-alert" role="alert">
          Could not load this take: {failed.message}
        </p>
      )}

      <div className="mst-replay__controls">
        <Button variant={pa.playing ? 'primary' : 'secondary'} onClick={() => apply((p) => p.toggle())} aria-label={pa.playing ? 'Pause' : 'Play'} disabled={!duration}>
          {pa.playing ? 'Pause' : 'Play'}
        </Button>
        <label className="mst-scrub">
          <span className="sr-only">Position in take</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(pa.position, duration)}
            onChange={(e) => apply((p) => p.seek(Number(e.target.value)))}
            disabled={!duration}
          />
          <span className="mst-scrub__time">
            {pa.position.toFixed(1)} / {duration.toFixed(1)} s
          </span>
        </label>
        <div className="mst-seg" role="group" aria-label="Playback speed">
          {RATES.map((r) => (
            <Button key={r} variant="toggle" aria-pressed={pa.rate === r} onClick={() => apply((p) => p.setRate(r))}>
              {r}x
            </Button>
          ))}
        </div>
        <Button variant="toggle" aria-pressed={loop} onClick={() => setLoop((v) => !v)}>
          Loop
        </Button>
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
            Back to live
          </Button>
        )}
      </div>
      <FingerLanes getHand={() => pa.getFrame(side)} label="Finger flexion of the replayed take" />
    </section>
  );
}
