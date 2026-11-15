import { useEffect } from 'react';
import { FINGERS, type Finger } from '../../../api/types';
import type { RobotStreamHandle } from '../../../api/useRobotStream';
import { FINGER_LABEL } from '../../apprentice/training/coach/tips';
import { Segmented } from '../../apprentice/training/Segmented';
import { ROBOT_MODEL_OPTIONS, useRobotModelChoice } from './robotPrefs';
import { RobotSourceControl } from './RobotSourceControl';
import type { FingerGains } from './RobotTwin';

/** The Dex3-1's fingers, when the engine has not said: thumb, index and middle, no ring or little. */
const DEX_MISSING: Finger[] = ['ring', 'little'];
const GAIN_STEP = 5;

/** The robot switch on its own: three fingers or five. Shared by Copy me and Show a move. */
export function RobotChoice() {
  const [model, setModel] = useRobotModelChoice();
  return (
    <div className="ap-field">
      <span className="ap-field__label">Which robot</span>
      <Segmented label="Which robot" value={model} options={ROBOT_MODEL_OPTIONS} onChange={setModel} />
    </div>
  );
}

interface CopyMePanelProps {
  robot: RobotStreamHandle;
  gains: FingerGains;
  onGains: (gains: FingerGains) => void;
}

/**
 * Copy me: a glove drives the robot live. Choose the robot, whose glove drives it (with the engine connected), and how
 * closely each finger copies: 100% copies the finger fully, 0% leaves it at rest. The Dex3-1 has no ring or little
 * finger, so those rows are marked and cannot be set.
 */
export function CopyMePanel({ robot, gains, onGains }: CopyMePanelProps) {
  const [model] = useRobotModelChoice();
  const connected = robot.status === 'open' && robot.hello !== null;
  const missing = new Set<Finger>(model === 'dex3_1' ? (robot.hello?.robot?.missing ?? DEX_MISSING) : []);
  const changed = FINGERS.some((f) => (gains[f] ?? 1) !== 1);

  // Copy me always follows a glove: if the engine was resting or playing its own lesson, hand the robot to the apprentice.
  const { source, setSource } = robot;
  useEffect(() => {
    if (connected && (source === 'lesson' || source === 'off')) void setSource('learner').catch(() => undefined);
  }, [connected, source, setSource]);

  return (
    <div className="rb-panel">
      <RobotChoice />
      {connected && <RobotSourceControl robot={robot} exclude={['lesson', 'off']} quiet />}
      {model === 'dex3_1' && !connected && <p className="note">Start the glove engine and the three-finger robot wakes up.</p>}
      <fieldset className="ap-field rb-listen">
        <legend className="ap-field__label">How closely each finger copies you</legend>
        {FINGERS.map((f) => {
          const gone = missing.has(f);
          const pct = Math.round((gains[f] ?? 1) * 100);
          const id = `rb-listen-${f}`;
          return (
            <div key={f} className={`rb-listen__row ${gone ? 'rb-listen__row--missing' : ''}`}>
              <label htmlFor={id} className="rb-listen__name">
                {FINGER_LABEL[f]}
              </label>
              <input
                id={id}
                type="range"
                min={0}
                max={100}
                step={GAIN_STEP}
                value={gone ? 0 : pct}
                disabled={gone}
                onChange={(e) => onGains({ ...gains, [f]: Number(e.target.value) / 100 })}
                aria-valuetext={gone ? `The robot has no ${f} finger` : `${pct} per cent`}
              />
              <span className={`rb-listen__value ${gone ? '' : 'ap-num'}`}>{gone ? 'No finger' : `${pct}%`}</span>
            </div>
          );
        })}
        {changed && (
          <button type="button" className="btn btn--ghost rb-listen__reset" onClick={() => onGains({})}>
            Copy every finger fully
          </button>
        )}
      </fieldset>
    </div>
  );
}
