import { SOURCE_OPTIONS, type RobotSource } from '../../../api/robot';
import type { RobotStreamHandle } from '../../../api/useRobotStream';
import { Segmented } from '../../apprentice/training/Segmented';

interface RobotSourceControlProps {
  robot: RobotStreamHandle;
  /** Sources not offered here (the five-finger robot has no engine lesson). */
  exclude?: RobotSource[];
  /** When set, the control is greyed out with this line instead of its hint (a browser lesson drives the robot). */
  paused?: string | null;
}

/** Who drives the robot: the expert's glove, the apprentice's glove, the lesson, or nobody. Sends set_robot_source to the engine. */
export function RobotSourceControl({ robot, exclude = [], paused = null }: RobotSourceControlProps) {
  const connected = robot.status === 'open' && robot.hello !== null;
  const value: RobotSource = robot.source ?? 'off';
  const options = SOURCE_OPTIONS.filter((o) => !exclude.includes(o.id));
  const current = options.find((o) => o.id === value);
  const active = connected && !paused;
  return (
    <div className="ap-field rb-source">
      <span className="ap-field__label">Who drives the robot</span>
      <div className={active ? '' : 'rb-source--off'} aria-disabled={!active}>
        <Segmented label="Robot source" value={value} options={options} onChange={(id) => void robot.setSource(id).catch(() => undefined)} grid />
      </div>
      <p className="note ap-field__hint">{paused ?? (connected ? current?.hint : 'Connect the robot engine to choose.')}</p>
      {robot.error && (
        <p className="note rb-error" role="alert">
          {robot.error}
        </p>
      )}
    </div>
  );
}
