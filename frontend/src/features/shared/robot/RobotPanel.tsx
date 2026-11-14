import { FINGERS, type Finger } from '../../../api/types';
import { CORE_PORT, useRobotView, type RobotStreamHandle } from '../../../api/useRobotStream';
import { jointFinger, shortJointName, SOURCE_LABEL, waitingLine } from '../../../api/robot';
import { Disclosure } from '../../../components/ui';
import { FINGER_LABEL } from '../../apprentice/training/coach/tips';
import { RobotSourceControl } from './RobotSourceControl';

interface RobotPanelProps {
  robot: RobotStreamHandle;
  /** Fewer words and no joint table, for the training room's side column. */
  compact?: boolean;
  /** Hide the source control (when it is shown elsewhere on the page). */
  noControl?: boolean;
}

const RAD = 180 / Math.PI;

/** One line on the state of the robot link, for the panel and the studio summary. */
export function robotStateLine(robot: RobotStreamHandle): { text: string; tone: 'ok' | 'wait' | 'off' } {
  if (robot.status !== 'open' || !robot.hello) {
    return { text: robot.status === 'connecting' ? `Looking for the robot engine on port ${CORE_PORT}...` : 'Robot engine not connected.', tone: 'off' };
  }
  const source = robot.source ?? 'off';
  if (source === 'off') return { text: 'The robot rests. Pick who drives it.', tone: 'off' };
  if (robot.live && robot.hand) return { text: `Following the ${SOURCE_LABEL[source].toLowerCase()}, ${robot.hand} hand.`, tone: 'ok' };
  return { text: waitingLine(source, robot.hello.session), tone: 'wait' };
}

/**
 * The robot's side panel: link state, who drives it, how much of each finger it can copy (fidelity), which human
 * fingers it lacks, and the live joint targets. Fidelity is the core's number: robot joints over human joints per
 * finger, less any clipping at the joint limits.
 */
export function RobotPanel({ robot, compact = false, noControl = false }: RobotPanelProps) {
  const view = useRobotView(8);
  const desc = robot.hello?.robot ?? null;
  const missing = new Set<Finger>(view?.missing ?? desc?.missing ?? []);
  const state = robotStateLine(robot);
  const model = desc?.model === 'dex3_1' ? 'Unitree Dex3-1' : desc?.model ?? 'robot hand';
  const joints = view ? Object.entries(view.q) : [];
  return (
    <div className={`rb-panel ${compact ? 'rb-panel--compact' : ''}`}>
      <p className={`rb-state rb-state--${state.tone}`} role="status">
        <span className="rb-state__dot" aria-hidden="true" />
        <span>
          <strong>{model}.</strong> {state.text}
          {robot.mock && ' Sample robot, offline.'}
        </span>
      </p>
      {!noControl && <RobotSourceControl robot={robot} />}
      <div className="ap-field">
        <span className="ap-field__label">How much of each finger it copies</span>
        <ul className="rb-fidelity" aria-label="Fidelity per finger">
          {FINGERS.map((f) => {
            const value = view?.fidelity?.[f];
            const gone = missing.has(f);
            const pct = gone || value === undefined ? null : Math.round(value * 100);
            return (
              <li key={f} className={`rb-fidelity__row ${gone ? 'rb-fidelity__row--missing' : ''}`}>
                <span className="rb-fidelity__name">{FINGER_LABEL[f]}</span>
                <span className="rb-bar" aria-hidden="true">
                  <span className="rb-bar__fill" style={{ width: `${pct ?? 0}%` }} />
                </span>
                <span className="rb-fidelity__value ap-num" aria-label={gone ? `${FINGER_LABEL[f]}: the robot has no ${f} finger` : `${FINGER_LABEL[f]}: ${pct ?? 0} percent`}>
                  {gone ? 'no finger' : pct === null ? '–' : `${pct}%`}
                </span>
              </li>
            );
          })}
        </ul>
        {!compact && (
          <p className="note ap-field__hint">
            Fidelity is how much of your finger the robot can copy: its joints over yours, less any clipping at its limits. Two robot joints for your three gives 67%.
            {missing.size > 0 && ` The ${[...missing].map((f) => FINGER_LABEL[f].toLowerCase()).join(' and ')} have no robot finger: their strings hang loose.`}
          </p>
        )}
      </div>
      {!compact && (
        <Disclosure summary="Joint targets" className="rb-joints">
          {joints.length === 0 ? (
            <p className="note">No targets yet.</p>
          ) : (
            <table className="rb-joints__table">
              <thead>
                <tr>
                  <th scope="col">Joint</th>
                  <th scope="col">Finger</th>
                  <th scope="col">Target</th>
                  <th scope="col">Of range</th>
                </tr>
              </thead>
              <tbody>
                {joints.map(([name, rad]) => {
                  const norm = view?.q_norm?.[name];
                  const finger = jointFinger(name);
                  return (
                    <tr key={name}>
                      <th scope="row">{shortJointName(name)}</th>
                      <td>{finger ? FINGER_LABEL[finger] : ''}</td>
                      <td className="ap-num">{`${Math.round(rad * RAD)}°`}</td>
                      <td>
                        <span className="rb-bar" aria-hidden="true">
                          <span className="rb-bar__fill" style={{ width: `${Math.round((norm ?? 0) * 100)}%` }} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {view && (
            <p className="note ap-field__hint">
              Joint names and limits come from the Dex3-1 URDF. Targets are radians clamped to those limits; the engine sends them 30 times a second.
            </p>
          )}
        </Disclosure>
      )}
    </div>
  );
}
