import { SOURCE_OPTIONS, type RobotSource } from '../../../api/robot';
import type { RobotStreamHandle } from '../../../api/useRobotStream';
import { Segmented } from '../../apprentice/training/Segmented';

interface RobotSourceControlProps {
  robot: RobotStreamHandle;
}

/** Who drives the robot: the expert's glove, the apprentice's glove, the lesson, or nobody. Sends set_robot_source to the engine. */
export function RobotSourceControl({ robot }: RobotSourceControlProps) {
  const connected = robot.status === 'open' && robot.hello !== null;
  const value: RobotSource = robot.source ?? 'off';
  const current = SOURCE_OPTIONS.find((o) => o.id === value);
  return (
    <div className="ap-field rb-source">
      <span className="ap-field__label">Who drives the robot</span>
      <div className={connected ? '' : 'rb-source--off'} aria-disabled={!connected}>
        <Segmented label="Robot source" value={value} options={SOURCE_OPTIONS} onChange={(id) => void robot.setSource(id).catch(() => undefined)} grid />
      </div>
      <p className="note ap-field__hint">{connected ? current?.hint : 'Connect the robot engine to choose.'}</p>
      {robot.error && (
        <p className="note rb-error" role="alert">
          {robot.error}
        </p>
      )}
    </div>
  );
}
