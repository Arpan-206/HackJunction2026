import '../threeSetup';
import { useMemo } from 'react';
import { FINGERS, type Finger } from '../../api/types';
import { FINGER_LABEL } from '../../features/apprentice/training/coach/tips';
import { handAt } from '../../features/shared/playback';
import { Hand } from '../../three/Hand';
import { CODEX_STAGE } from '../../three/parchment';
import { HandCanvas } from '../../three/Stage';
import { useLoopClock } from '../clock';
import type { TourTake } from '../data';
import { momentAt, replayCoach } from '../replayCoach';
import { StageFrame } from '../StageFrame';
import { PlayButton, SIDE_VIEW, useTake } from './shared';

export default function TrainingStop() {
  const expert = useTake('expert');
  const attempt = useTake('attempt');
  return (
    <section className="tour-stop">
      <p className="tour-lead">
        The learner's wooden hand plays a recorded attempt at the same grip. The faint ghost is the expert's take, to follow. A finger that strays past its band turns
        vermilion, and the correction names it.
      </p>
      {expert && attempt ? <TrainingStage expert={expert} attempt={attempt} /> : <p className="tour-loading">Loading the two takes...</p>}
      <p className="tour-small">
        The attempt is a second real glove take of the same step. Its corrections and score are replayed through the same scorer and live-correction code the app runs,
        so they are what the learner saw from these frames. They are not a log of the session.
      </p>
    </section>
  );
}

function TrainingStage({ expert, attempt }: { expert: TourTake; attempt: TourTake }) {
  const replay = useMemo(() => replayCoach(expert.frames, attempt.frames, attempt.side), [expert, attempt]);
  const clock = useLoopClock(attempt.duration);
  const m = momentAt(replay, clock.shown);
  const tint = useMemo(() => {
    const out: Partial<Record<Finger, string>> = {};
    if (m) for (const f of FINGERS) if (m.status[f] === 'off') out[f] = CODEX_STAGE.vermilion;
    return out;
  }, [m]);
  const final = Math.round(replay.result.overall);
  return (
    <>
      <StageFrame text="The learner's wooden hand closes into the grip beside the faint ghost of the expert's hand. Fingers that stray turn vermilion.">
        <HandCanvas preset="single" stage={{ decor: false, cameraPosition: SIDE_VIEW }} label="The learner's recorded attempt in wood, with the expert's ghost hand">
          <Hand side={expert.side} style="ghost" getFrame={() => handAt(expert.frames, clock.now(), expert.side)} />
          <Hand side={attempt.side} style="wood" fingerTint={tint} getFrame={() => handAt(attempt.frames, clock.now(), attempt.side)} />
        </HandCanvas>
      </StageFrame>
      <div className="tour-controls">
        <PlayButton clock={clock} />
        <span className="tour-time">
          {clock.shown.toFixed(1)} s of {attempt.duration.toFixed(1)} s
        </span>
      </div>
      <div className="tour-panel" aria-live="off">
        <p className="tour-score">
          Live score <strong className="ap-num">{m ? m.score : '-'}</strong>
        </p>
        <p className={`tour-tip ${m?.tip ? 'tour-tip--off' : 'tour-tip--ok'}`}>{m?.tip ?? 'Every finger is in line.'}</p>
        <ul className="tour-fingers" aria-label="Each finger against the expert">
          {FINGERS.map((f) => {
            const off = m?.status[f] === 'off';
            const d = m ? Math.round(m.deviation[f]) : 0;
            return (
              <li key={f} className={off ? 'is-off' : 'is-ok'}>
                <span>{FINGER_LABEL[f]}</span>
                <span>{off ? `${Math.abs(d)} degrees too ${d > 0 ? 'curled' : 'open'}` : 'in line'}</span>
              </li>
            );
          })}
        </ul>
        <p className="tour-result">
          The rep ends on <strong className="ap-num">{final}</strong> out of 100: finger shape counts 80%, timing 20%. Worst finger:{' '}
          {FINGER_LABEL[replay.result.worst_finger].toLowerCase()}.
        </p>
      </div>
    </>
  );
}
