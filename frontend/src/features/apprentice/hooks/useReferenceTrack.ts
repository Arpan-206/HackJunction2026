import { useEffect, useMemo, useState } from 'react';
import { api, type MediaRef, type Side, type Step } from '../../../api';
import { trackFromFrames, trackFromMotion, type ReferenceTrack } from '../training/coach/reference';

export interface ReferenceState {
  track: ReferenceTrack | null;
  loading: boolean;
  /** Plain-language note when the stored recording could not be used and the mock guide stands in. */
  notice: string | null;
  /** The webcam filmed during the reference take (Recording.video), when the expert added one; null for a mock guide. */
  video: MediaRef | null;
}

/** The side of the body a step is practised with; for a two-handed step this is the default coached hand, the right. */
export function stepSide(step: Step): Side {
  return step.hands === 'left' ? 'left' : 'right';
}

/**
 * The master reference for a step: its recording from GET /api/recordings/{id}, or the step's mock motion through the
 * local synthesiser when there is no recording or the backend cannot be reached.
 */
export function useReferenceTrack(step: Step | null, sideOverride?: Side): ReferenceState {
  const recordingId = step?.reference_recording_id ?? null;
  const side = sideOverride ?? (step ? stepSide(step) : 'right');
  const [recorded, setRecorded] = useState<{ id: string; track: ReferenceTrack; video: MediaRef | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(recordingId));

  useEffect(() => {
    if (!recordingId) {
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    api
      .recording(recordingId, ctl.signal)
      .then((rec) => {
        if (!rec.frames.length) throw new Error('The recording is empty.');
        setRecorded({ id: recordingId, track: trackFromFrames(rec.frames, side), video: rec.video ?? null });
        setFailed(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setFailed(e instanceof Error ? e.message : 'Recording unavailable.');
        setLoading(false);
      });
    return () => ctl.abort();
  }, [recordingId, side]);

  const guide = useMemo(() => (step ? trackFromMotion(step.motion, side) : null), [step, side]);
  const useRecording = recordingId !== null && recorded?.id === recordingId;
  return {
    track: useRecording && recorded ? recorded.track : guide,
    video: useRecording && recorded ? recorded.video : null,
    loading: loading && recordingId !== null,
    notice: failed ? `The expert's recording could not be loaded (${failed}). Showing the mock guide instead.` : null,
  };
}
