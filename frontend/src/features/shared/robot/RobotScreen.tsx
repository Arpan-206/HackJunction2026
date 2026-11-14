import { useGloveStream } from '../../../api';
import { useRobotStream } from '../../../api/useRobotStream';
import { PageHeader } from '../../../components/PageHeader';
import { RobotPanel } from './RobotPanel';
import { RobotTwin, type TwinHuman } from './RobotTwin';
import './robot.css';

/**
 * /robot: the teleoperation view. The glove drives a Unitree Dex3-1 twin, with the source switch (expert, apprentice,
 * lesson, off), the per-finger fidelity and the joint targets, read from the engine's /ws/robot.
 */
export default function RobotScreen() {
  const robot = useRobotStream(true);
  const gloves = useGloveStream(true);
  const source = robot.source ?? 'off';
  const human: TwinHuman = {
    side: robot.hand ?? 'right',
    style: source === 'learner' ? 'wood' : 'chalk',
    live: gloves.latest,
    label: source === 'master' ? 'The expert' : source === 'lesson' ? 'The lesson' : 'You',
  };
  return (
    <div className="rb-screen">
      <PageHeader title="Robot hand" context="Your glove drives a Unitree Dex3-1 twin. Choose who drives it and watch how closely it follows." />
      <div className="rb-screen__grid">
        <section className="rb-screen__stage" aria-label="Robot twin">
          <RobotTwin robot={robot} human={human} className="rb-twin--tall" />
          <p className="note rb-screen__cap">
            {robot.status === 'open' && robot.hello
              ? 'Strings run from each of your fingertips to the robot’s. The ring and little finger have no robot finger, so their strings hang loose.'
              : 'Start the glove engine (python -m core --fake, or with the gloves) and the robot wakes up here.'}
          </p>
        </section>
        <aside className="card ap-panel rb-screen__side" aria-label="Robot controls">
          <RobotPanel robot={robot} />
        </aside>
      </div>
    </div>
  );
}
