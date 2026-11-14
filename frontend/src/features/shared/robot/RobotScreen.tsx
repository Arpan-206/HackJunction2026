import { useGloveStream } from '../../../api';
import { useRobotStream } from '../../../api/useRobotStream';
import { PageHeader } from '../../../components/PageHeader';
import { useCallback, useState } from 'react';
import { Segmented } from '../../apprentice/training/Segmented';
import { RobotLessonPlayer } from './RobotLessonPlayer';
import { RobotPanel } from './RobotPanel';
import { useRobotModelChoice } from './robotPrefs';
import { RobotTwin, type TwinHuman, type TwinLesson } from './RobotTwin';
import { RobotTeachPanel, ROBOT_NAME } from './teach/RobotTeachPanel';
import './robot.css';

type ScreenMode = 'drive' | 'teach';
const MODES: { id: ScreenMode; label: string; hint: string }[] = [
  { id: 'drive', label: 'Drive it', hint: 'Your glove or a lesson moves the robot.' },
  { id: 'teach', label: 'Teach it', hint: 'The robot tries a lesson step and you correct it.' },
];

/**
 * /robot. Drive it: the glove drives a robot twin, the Unitree Dex3-1 (three fingers, joint targets from the engine's
 * /ws/robot) or the five-finger humanoid, which copies every human joint and can also play any lesson step in the
 * browser. Teach it: the five-finger robot is the apprentice, it attempts a lesson step with a planted fault, and the
 * learner corrects it by tapping, by words, by voice or by showing it with the glove.
 */
export default function RobotScreen() {
  const robot = useRobotStream(true);
  const gloves = useGloveStream(true);
  const source = robot.source ?? 'off';
  const [chosen] = useRobotModelChoice();
  const [mode, setMode] = useState<ScreenMode>('drive');
  const model = mode === 'teach' ? 'humanoid' : chosen;
  const [lesson, setLessonRaw] = useState<TwinLesson | null>(null);
  const setLesson = useCallback((l: TwinLesson | null) => setLessonRaw(l), []);
  const human: TwinHuman = {
    side: robot.hand ?? 'right',
    style: source === 'learner' ? 'wood' : 'chalk',
    live: gloves.latest,
    label: source === 'master' ? 'The expert' : source === 'lesson' ? 'The lesson' : 'You',
  };
  const teaching = mode === 'teach';
  let caption: string;
  if (teaching) caption = lesson?.speech ?? `${ROBOT_NAME} is getting ready...`;
  else if (model === 'humanoid')
    caption = lesson
      ? 'The expert’s hand pulls the strings and the robot performs the lesson step, on a loop.'
      : robot.status === 'open' && robot.hello && (source === 'off' || source === 'lesson')
        ? 'The robot rests. Pick a glove to drive it, or play a lesson.'
        : 'Strings run from each of your fingertips to the robot’s. It has all five fingers, so every string is taut.';
  else
    caption =
      robot.status === 'open' && robot.hello
        ? 'Strings run from each of your fingertips to the robot’s. The ring and little finger have no robot finger, so their strings hang loose.'
        : 'Start the glove engine (python -m core --fake, or with the gloves) and the robot wakes up here.';
  return (
    <div className={`rb-screen ${teaching ? 'rb-screen--teach' : ''}`}>
      <PageHeader
        title="Robot hand"
        context={
          teaching
            ? `${ROBOT_NAME}, Geppetto's wooden robot, tries a lesson step. Is anything wrong? Spot it and teach it: tap it, say it, or show it with your glove.`
            : 'Your glove drives a robot hand: the three-finger Unitree Dex3-1 or a five-finger humanoid. Choose who drives it and watch how closely it follows.'
        }
      />
      <div className="rb-screen__grid">
        <section className="rb-screen__stage" aria-label="Robot twin">
          <div className="rb-screen__twin">
            <RobotTwin robot={robot} model={model} human={human} lesson={model === 'humanoid' ? lesson : null} className="rb-twin--tall" />
            {teaching && lesson?.banner && (
              <span className="rb-screen__banner" aria-hidden="true">
                {lesson.banner}
              </span>
            )}
          </div>
          <p className={`note rb-screen__cap ${teaching ? 'rb-screen__cap--speech' : ''}`} role={teaching ? 'status' : undefined} aria-live={teaching ? 'polite' : undefined}>
            {teaching && <strong>{ROBOT_NAME}: </strong>}
            {caption}
          </p>
        </section>
        <aside className="card ap-panel rb-screen__side" aria-label="Robot controls">
          <div className="ap-field rb-screen__mode">
            <span className="ap-field__label">What the robot does</span>
            <Segmented
              label="Robot mode"
              value={mode}
              options={MODES}
              onChange={(m) => {
                setLesson(null);
                setMode(m);
              }}
            />
          </div>
          {teaching ? (
            <RobotTeachPanel gloves={gloves} onChange={setLesson} />
          ) : (
            <>
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
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
