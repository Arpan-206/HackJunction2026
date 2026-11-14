import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FINGERS, type Finger, type GloveFrame, type HandFrame } from '../../../../api/types';
import type { ReferenceTrack } from '../../../apprentice/training/coach/reference';
import {
  applyInstruction,
  bakeDemo,
  CYCLE_SAMPLES,
  describeFault,
  faultCandidates,
  fingerErrors,
  fixesFault,
  PASS_SCORE,
  planRounds,
  robotHandAt,
  robotScore,
  withFault,
  perfectSkill,
  type CycleSource,
  type Instruction,
  type RobotSkill,
  type RoundPlan,
} from './robotSkill';
import { echo, FINGER_NAME, question, understand } from './understand';

/** One exchange in the teaching log: what the teacher did and what the robot said back. */
export interface TeachLogEntry {
  id: number;
  /** The teacher's words, or a plain description of a tap or a demonstration. */
  said: string;
  reply: string;
  /** The robot's score before and after, when the exchange changed the robot. */
  before?: number;
  after?: number;
}

/** How a finished round went, for the summary. */
export interface RoundSummary {
  kind: RoundPlan['kind'];
  fault: string;
  corrections: number;
  /** The first change the teacher asked for fixed the fault (or, in a catch round, they left it alone). */
  firstTry: boolean;
  hinted: boolean;
  /**
   * How it ended: taught (the robot passed after the teacher's changes), left (a catch round left alone), missed (the
   * teacher said it looked right while it was wrong) or gave_up (the teacher asked to see the fault).
   */
  outcome: 'taught' | 'left' | 'missed' | 'gave_up';
  scores: number[];
}

export type DemoState = 'idle' | 'countdown' | 'recording';

export interface TeachSession {
  round: number;
  rounds: number;
  plan: RoundPlan | null;
  score: number;
  /** Scores this round, one per change, starting with the robot's first attempt. */
  scores: number[];
  /** The teacher has said or done something this round (the score is hidden until then). */
  heard: boolean;
  /** The round is over: passed, or revealed. */
  over: boolean;
  passed: boolean;
  done: boolean;
  line: string;
  log: TeachLogEntry[];
  summary: RoundSummary[];
  hintFinger: Finger | null;
  demo: DemoState;
  countdown: number;
  /** The expert's hand and the robot's hand, on one shared clock that restarts with each new attempt. */
  expertFrame: (t: number) => HandFrame | null;
  robotFrame: (t: number) => HandFrame | null;
  tell: (instructions: Instruction[], said: string) => void;
  sayText: (text: string) => void;
  looksRight: (said?: string) => void;
  hint: () => void;
  reveal: () => void;
  next: () => void;
  startDemo: () => void;
}

/** Seconds of countdown before a glove demonstration records, so the teacher can get ready. */
export const DEMO_COUNTDOWN_S = 3;

/** Every round opens with the same line, so nothing but the hand itself says whether something is wrong. */
const START_LINE = 'Watch me. Did I get it right?';

function pickHand(f: GloveFrame | null, side: string): HandFrame | null {
  return f?.hands.find((h) => h.side === side) ?? null;
}

/**
 * One teaching session: the robot performs a lesson step with a planted fault, the teacher tells it or shows it what to
 * fix, and its score (the teacher's score) shows whether the teaching worked. Four rounds, research/14.
 */
export function useTeachSession(track: ReferenceTrack, speed: number, weights: Partial<Record<Finger, number>> | null | undefined, glove: RefObject<GloveFrame | null>): TeachSession {
  const expert: CycleSource = track.handAt;
  const period = track.period;
  const plans = useMemo(() => planRounds(faultCandidates(expert, period, weights)), [expert, period, weights]);
  const [round, setRound] = useState(0);
  const [skill, setSkill] = useState<RobotSkill>(() => withFault(plans[0]?.fault ?? null));
  const [source, setSource] = useState<CycleSource>(() => expert);
  const [scores, setScores] = useState<number[]>([]);
  const [over, setOver] = useState(false);
  const [heard, setHeard] = useState(false);
  const [passed, setPassed] = useState(false);
  const [line, setLine] = useState(START_LINE);
  const [log, setLog] = useState<TeachLogEntry[]>([]);
  const [summary, setSummary] = useState<RoundSummary[]>([]);
  const [hintFinger, setHintFinger] = useState<Finger | null>(null);
  const [demo, setDemo] = useState<DemoState>('idle');
  const [countdown, setCountdown] = useState(0);
  const lastFinger = useRef<Finger | null>(null);
  const stats = useRef({ corrections: 0, firstTry: null as boolean | null, hinted: false });
  const logId = useRef(0);

  // One clock for both hands. A new attempt restarts it, so the teacher watches the whole step again from its start.
  const t0 = useRef(performance.now());
  const restart = () => {
    t0.current = performance.now();
  };
  const clock = () => ((performance.now() - t0.current) / 1000) * speed;
  const live = useRef({ skill, source });
  live.current = { skill, source };

  const scoreOf = useCallback((s: RobotSkill, src: CycleSource) => robotScore(fingerErrors(expert, (t) => robotHandAt(src, s, t), period)), [expert, period]);
  const score = useMemo(() => scoreOf(skill, source), [scoreOf, skill, source]);

  // A new step or a new plan starts the session over.
  useEffect(() => {
    setRound(0);
    setSkill(withFault(plans[0]?.fault ?? null));
    setSource(() => expert);
    setScores([scoreOf(withFault(plans[0]?.fault ?? null), expert)]);
    setOver(false);
    setPassed(false);
    setLine(START_LINE);
    setLog([]);
    setSummary([]);
    setHintFinger(null);
    setHeard(false);
    stats.current = { corrections: 0, firstTry: null, hinted: false };
    lastFinger.current = null;
    restart();
  }, [plans, expert, scoreOf]);

  const plan = plans[round] ?? null;

  const addLog = (said: string, reply: string, before?: number, after?: number) => {
    logId.current += 1;
    const id = logId.current;
    setLog((l) => [...l.slice(-7), { id, said, reply, before, after }]);
    setHeard(true);
  };

  const finishRound = (outcome: RoundSummary['outcome'], finalScores: number[]) => {
    const didPass = outcome === 'taught' || outcome === 'left';
    setOver(true);
    setPassed(didPass);
    setSummary((s) => [
      ...s,
      {
        kind: plan?.kind ?? 'fault',
        fault: describeFault(plan?.fault ?? null),
        corrections: stats.current.corrections,
        firstTry: stats.current.firstTry ?? (plan?.kind === 'catch' && didPass),
        hinted: stats.current.hinted,
        outcome,
        scores: finalScores,
      },
    ]);
  };

  /** Applies a change to the robot and has it react to its new score. */
  const change = (nextSkill: RobotSkill, nextSource: CycleSource, said: string, echoed: string) => {
    if (over) return;
    const before = score;
    const after = scoreOf(nextSkill, nextSource);
    setSkill(nextSkill);
    setSource(() => nextSource);
    const all = [...scores, after];
    setScores(all);
    stats.current.corrections += 1;
    let reaction: string;
    if (after >= PASS_SCORE) reaction = `I think I have it! My score is ${after}.`;
    else if (after > before + 2) reaction = `Better! My score went from ${before} to ${after}.`;
    else if (after < before - 2) reaction = `Hmm, that made it worse: ${before} down to ${after}.`;
    else reaction = `That changed almost nothing. My score is still ${after}.`;
    const reply = `${echoed} ${reaction}`.trim();
    setLine(reply);
    addLog(said, reply, before, after);
    restart();
    if (after >= PASS_SCORE) finishRound('taught', all);
  };

  const tell = (instructions: Instruction[], said: string) => {
    if (over || !instructions.length || demo !== 'idle') return;
    if (stats.current.firstTry === null) stats.current.firstTry = plan?.kind !== 'catch' && fixesFault(instructions[0], plan?.fault ?? null);
    let s = live.current.skill;
    for (const ins of instructions) s = applyInstruction(s, ins);
    lastFinger.current = instructions[instructions.length - 1].finger;
    change(s, live.current.source, said, instructions.map(echo).join(' '));
  };

  /**
   * The teacher's final answer that nothing needs fixing. Right in a catch round (or once the teaching has fixed it); in a
   * round that still has a fault it is a miss, and the robot shows what was wrong. It never prints the score, so it is
   * no free oracle.
   */
  const looksRight = (said = 'It looks right.') => {
    if (over || demo !== 'idle') return;
    if (score >= PASS_SCORE) {
      if (stats.current.firstTry === null) stats.current.firstTry = plan?.kind === 'catch';
      const left = plan?.kind === 'catch' && stats.current.corrections === 0;
      const reply = left ? 'Thank you! I had it right this time.' : 'Thank you! I think I have it now.';
      setLine(reply);
      addLog(said, reply);
      finishRound(left ? 'left' : 'taught', scores);
      return;
    }
    if (stats.current.firstTry === null) stats.current.firstTry = false;
    const reply = `Not quite. ${describeFault(plan?.fault ?? null, 'robot')} Watch me do it right.`;
    setSkill(perfectSkill());
    setSource(() => expert);
    setHintFinger(plan?.fault?.finger ?? null);
    setLine(reply);
    addLog(said, reply);
    restart();
    finishRound('missed', scores);
  };

  const sayText = (text: string) => {
    if (over || demo !== 'idle') return;
    const u = understand(text, lastFinger.current);
    if (u.kind === 'instructions') return tell(u.instructions, `“${text.trim()}”`);
    if (u.kind === 'ok') return looksRight(`“${text.trim()}”`);
    const reply = u.kind === 'ask' ? question(u) : 'I did not catch that. Try “curl your index more” or “thumb a bit earlier”.';
    if (u.kind === 'ask' && u.fingers.length === 1) lastFinger.current = u.fingers[0];
    setLine(reply);
    addLog(`“${text.trim()}”`, reply);
  };

  // In a catch round the hint points at a finger chosen at random, so asking for one never gives the round away.
  const hint = () => {
    if (over) return;
    stats.current.hinted = true;
    const f = plan?.fault?.finger ?? FINGERS[Math.floor(Math.random() * FINGERS.length)];
    setHintFinger(f);
    const reply = `Check my ${FINGER_NAME[f]} closely. It is marked in red.`;
    setLine(reply);
    addLog('You asked for a hint.', reply);
  };

  const reveal = () => {
    if (over) return;
    const reply = `${describeFault(plan?.fault ?? null, 'robot')} Watch me do it right.`;
    setSkill(perfectSkill());
    setSource(() => expert);
    setLine(reply);
    addLog('You asked to see what was wrong.', reply);
    setHintFinger(plan?.fault?.finger ?? null);
    restart();
    finishRound('gave_up', scores);
  };

  const next = () => {
    const r = round + 1;
    setRound(r);
    setHintFinger(null);
    setOver(false);
    setPassed(false);
    setHeard(false);
    stats.current = { corrections: 0, firstTry: null, hinted: false };
    lastFinger.current = null;
    const p = plans[r];
    if (!p) {
      setLine('That is every round. Thank you for teaching me!');
      return;
    }
    // A demonstration taught the robot the whole step, so the next round starts again from the expert's motion.
    const s = withFault(p.fault);
    setSkill(s);
    setSource(() => expert);
    setScores([scoreOf(s, expert)]);
    setLine(START_LINE);
    restart();
  };

  // A glove demonstration: a countdown, then one full cycle recorded against the restarted clock, then baked in.
  const startDemo = () => {
    if (over || demo !== 'idle') return;
    setDemo('countdown');
    setCountdown(DEMO_COUNTDOWN_S);
  };

  useEffect(() => {
    if (demo !== 'countdown') return;
    if (countdown <= 0) {
      setDemo('recording');
      setLine('Recording. Do the step with the expert...');
      restart();
      return;
    }
    setLine(`Show me with your glove. Start with the expert in ${countdown}...`);
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [demo, countdown]);

  useEffect(() => {
    if (demo !== 'recording') return;
    const samples: (HandFrame | null)[] = new Array(CYCLE_SAMPLES).fill(null);
    const side = track.side;
    let raf = 0;
    const tick = () => {
      const t = clock();
      if (t >= period) {
        // Fill any sample the frame rate skipped from its nearest neighbour.
        for (let i = 0; i < samples.length; i++) if (!samples[i]) samples[i] = samples[(i + samples.length - 1) % samples.length];
        const got = samples.filter(Boolean).length;
        setDemo('idle');
        if (got < samples.length / 2) {
          const reply = 'I could not see your glove for most of that. Check it is connected and try again.';
          setLine(reply);
          addLog('You showed it with your glove.', reply);
          return;
        }
        const { skill: s, source: src } = live.current;
        const current: CycleSource = (x) => robotHandAt(src, s, x);
        change(perfectSkill(), bakeDemo(current, samples, period), 'You showed it with your glove.', 'I copied your hand.');
        return;
      }
      const i = Math.min(samples.length - 1, Math.floor((t / period) * samples.length));
      samples[i] = pickHand(glove.current, side) ?? samples[i];
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The recording runs once per start; the handlers it calls read the latest state through refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  return {
    round,
    rounds: plans.length,
    plan,
    score,
    scores,
    heard,
    over,
    passed,
    done: round >= plans.length,
    line,
    log,
    summary,
    hintFinger,
    demo,
    countdown,
    expertFrame: () => track.handAt(clock()),
    robotFrame: () => {
      const { skill: s, source: src } = live.current;
      return robotHandAt(src, s, clock());
    },
    tell,
    sayText,
    looksRight,
    hint,
    reveal,
    next,
    startDemo,
  };
}
