import { useGloveStream } from '../../../api';
import { useRobotStream } from '../../../api/useRobotStream';
import { PageHeader } from '../../../components/PageHeader';
import { useCallback, useEffect, useState } from 'react';
import { Segmented } from '../../apprentice/training/Segmented';
import { CopyMePanel, RobotChoice } from './CopyMePanel';
import { RobotLessonPlayer } from './RobotLessonPlayer';
import { useRobotModelChoice } from './robotPrefs';
import { RobotTwin, type FingerGains, type TwinHuman, type TwinLesson } from './RobotTwin';
import { RobotTeachPanel, ROBOT_NAME } from './teach/RobotTeachPanel';
import './robot.css';

type ScreenMode = 'copy' | 'show' | 'teach';
const MODES: { id: ScreenMode; label: string }[] = [
  { id: 'copy', label: 'Copy me' },
  { id: 'show', label: 'Show a move' },
  { id: 'teach', label: 'Teach it' },
];

/**
 * Show a move on the three-finger robot opens on sign language: spelling a word moves the thumb, index and middle the
 * most, so the Dex3-1 is busiest there. The five-finger robot keeps the first lesson.
 */
const THREE_FINGER_LESSONS = ['seed-fingerspelling-words'] as const;
const NO_PREFERENCE: readonly string[] = [];

const CONTEXT: Record<ScreenMode, string> = {
  copy: 'Your glove pulls the strings and the robot hand follows, finger by finger.',
  show: 'The robot performs an expert’s move from a lesson, in real time.',
  teach: `${ROBOT_NAME} tries a lesson step. Spot what is wrong and teach it: tap it, tell it, or show it with your glove.`,
};

/**
 * /robot, three modes. Copy me: a glove drives the robot live, the three-finger Unitree Dex3-1 (joint targets from the
 * engine's /ws/robot) or the five-finger humanoid, with a dial per finger for how closely it copies. Show a move: the
 * robot performs a lesson step from the expert's take, either robot. Teach it: the five-finger robot is the apprentice,
 * it attempts a lesson step with a planted fault, and the learner corrects it by tapping, by words or with the glove.
 */
export default function RobotScreen() {
  const robot = useRobotStream(true);
  const gloves = useGloveStream(true);
  const source = robot.source ?? 'off';
  const [chosen] = useRobotModelChoice();
  const [mode, setMode] = useState<ScreenMode>('copy');
  const [gains, setGains] = useState<FingerGains>({});
  const model = mode === 'teach' ? 'humanoid' : chosen;
  const [lesson, setLessonRaw] = useState<TwinLesson | null>(null);
  const setLesson = useCallback((l: TwinLesson | null) => setLessonRaw(l), []);
  const teaching = mode === 'teach';
  const human: TwinHuman | null =
    mode === 'show' ? null : { side: robot.hand ?? 'right', style: source === 'learner' ? 'wood' : 'chalk', live: gloves.latest, label: source === 'master' ? 'The expert' : 'You' };
  // Copy me with no glove hand arriving: say what to do, so a still robot never reads as a broken screen.
  const [handIn, setHandIn] = useState(true);
  const humanSide = human?.side ?? 'right';
  useEffect(() => {
    if (mode !== 'copy') return;
    const check = () => setHandIn(gloves.status === 'open' && !!gloves.latest.current?.hands.some((h) => h.side === humanSide));
    check();
    const id = window.setInterval(check, 1000);
    return () => window.clearInterval(id);
  }, [mode, gloves, humanSide]);
  const caption = teaching
    ? (lesson?.speech ?? `${ROBOT_NAME} is getting ready...`)
    : mode === 'copy' && !handIn
      ? `Put on the ${humanSide} glove and move your hand.`
      : null;
  return (
    <div className={`rb-screen ${teaching ? 'rb-screen--teach' : ''}`}>
      <PageHeader title="Robot hand" context={CONTEXT[mode]} />
      <div className="rb-screen__modes">
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
      <div className="rb-screen__grid">
        <section className="rb-screen__stage" aria-label="Robot twin">
          <div className="rb-screen__twin">
            <RobotTwin robot={robot} model={model} human={human} lesson={lesson} gains={mode === 'copy' ? gains : null} className="rb-twin--tall" />
            {teaching && lesson?.score && (
              <span className={`rb-screen__score ${lesson.score.passed ? 'rb-screen__score--ok' : ''}`} role="status">
                <span className="rb-screen__score-label">{`${ROBOT_NAME}'s score`}</span>
                <span className="ap-num">{lesson.score.value}</span>
              </span>
            )}
            {teaching && lesson?.banner && (
              <span className="rb-screen__banner" aria-hidden="true">
                {lesson.banner}
              </span>
            )}
          </div>
          {caption && (
            <p className={`note rb-screen__cap ${teaching ? 'rb-screen__cap--speech' : ''}`} role={teaching ? 'status' : undefined} aria-live={teaching ? 'polite' : undefined}>
              {teaching && <strong>{ROBOT_NAME}: </strong>}
              {caption}
            </p>
          )}
        </section>
        <aside className="card ap-panel rb-screen__side" aria-label="Robot controls">
          {mode === 'copy' && <CopyMePanel robot={robot} gains={gains} onGains={setGains} />}
          {mode === 'show' && (
            <div className="rb-panel">
              <RobotChoice />
              <RobotLessonPlayer onChange={setLesson} autoPlay prefer={chosen === 'dex3_1' ? THREE_FINGER_LESSONS : NO_PREFERENCE} />
            </div>
          )}
          {teaching && <RobotTeachPanel gloves={gloves} onChange={setLesson} />}
        </aside>
      </div>
    </div>
  );
}
