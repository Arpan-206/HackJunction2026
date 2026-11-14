import { useGloveStream } from '../../../api';
import { useRobotStream } from '../../../api/useRobotStream';
import { PageHeader } from '../../../components/PageHeader';
import { useCallback, useState } from 'react';
import { RobotLessonPlayer } from './RobotLessonPlayer';
import { RobotPanel } from './RobotPanel';
import { useRobotModelChoice } from './robotPrefs';
import { RobotTwin, type TwinHuman, type TwinLesson } from './RobotTwin';
import './robot.css';

/**
 * /robot: the teleoperation view. The glove drives a robot twin: the Unitree Dex3-1 (three fingers, joint targets from
 * the engine's /ws/robot, with the source switch, per-finger fidelity and joint table), or the five-finger humanoid,
 * which copies every human joint and can also play any lesson step in the browser, at expert or half speed.
 */
export default function RobotScreen() {
  const robot = useRobotStream(true);
  const gloves = useGloveStream(true);
  const source = robot.source ?? 'off';
  const [model] = useRobotModelChoice();
  const [lesson, setLessonRaw] = useState<TwinLesson | null>(null);
  const setLesson = useCallback((l: TwinLesson | null) => setLessonRaw(l), []);
  const human: TwinHuman = {
    side: robot.hand ?? 'right',
    style: source === 'learner' ? 'wood' : 'chalk',
    live: gloves.latest,
    label: source === 'master' ? 'The expert' : source === 'lesson' ? 'The lesson' : 'You',
  };
  return (
    <div className="rb-screen">
      <PageHeader title="Robot hand" context="Your glove drives a robot hand: the three-finger Unitree Dex3-1 or a five-finger humanoid. Choose who drives it and watch how closely it follows." />
      <div className="rb-screen__grid">
        <section className="rb-screen__stage" aria-label="Robot twin">
          <RobotTwin robot={robot} human={human} lesson={model === 'humanoid' ? lesson : null} className="rb-twin--tall" />
          <p className="note rb-screen__cap">
            {model === 'humanoid'
              ? lesson
                ? 'The expert\u2019s hand pulls the strings and the robot performs the lesson step, on a loop.'
                : robot.status === 'open' && robot.hello && (source === 'off' || source === 'lesson')
                  ? 'The robot rests. Pick a glove to drive it, or play a lesson.'
                  : 'Strings run from each of your fingertips to the robot\u2019s. It has all five fingers, so every string is taut.'
              : robot.status === 'open' && robot.hello
              ? 'Strings run from each of your fingertips to the robot’s. The ring and little finger have no robot finger, so their strings hang loose.'
              : 'Start the glove engine (python -m core --fake, or with the gloves) and the robot wakes up here.'}
          </p>
        </section>
        <aside className="card ap-panel rb-screen__side" aria-label="Robot controls">
          <RobotPanel
            robot={robot}
            modelControl
            playing={model === 'humanoid' ? lesson?.label ?? null : null}
            lessonSlot={model === 'humanoid' ? <RobotLessonPlayer onChange={setLesson} /> : null}
          />
          {model !== 'humanoid' && (
            <p className="note rb-screen__lesson">
              The three-finger robot plays lessons from the glove engine: choose Lesson under Who drives the robot. Switch to five fingers to play any lesson
              here, with no engine.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
