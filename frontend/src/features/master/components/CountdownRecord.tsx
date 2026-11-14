import { useEffect } from 'react';
import { Countdown, RecordButton } from '../../../components/ui';
import type { RecordContext, RecorderHandle } from '../hooks/useRecorder';

interface CountdownRecordProps {
  recorder: RecorderHandle;
  /** What to label the take with when it starts. */
  context: RecordContext;
  disabled?: boolean;
  caption?: string;
}

/** The big record control: 3-2-1 countdown overlay, then a live REC timer with Stop. Escape cancels the countdown. */
export function CountdownRecord({ recorder, context, disabled, caption = 'Get ready, begin the move on zero' }: CountdownRecordProps) {
  const { phase, begin, stop, cancel } = recorder;

  useEffect(() => {
    if (phase !== 'countdown') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, cancel]);

  return (
    <>
      <RecordButton
        recording={phase === 'recording'}
        elapsedS={recorder.elapsedS}
        disabled={disabled || phase === 'countdown' || phase === 'saving'}
        onToggle={() => (phase === 'recording' ? stop() : begin(context))}
        labels={{ start: phase === 'saving' ? 'Saving...' : 'Record a take', stop: 'Stop' }}
      />
      {phase === 'countdown' && <Countdown caption={caption} onDone={recorder.countdownDone} />}
    </>
  );
}
