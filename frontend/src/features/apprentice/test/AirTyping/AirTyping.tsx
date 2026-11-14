import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGloveStream, type Finger, type Lesson, type Side, type TestSpec } from '../../../../api';
import { Button, Card } from '../../../../components/ui';
import { PropSwitch } from '../../../shared/PropSwitch';
import { useShowProps } from '../../../shared/sessionPrefs';
import { useMargin } from '../../../shared/settings';
import { useStreamClock } from '../../hooks/useStreamClock';
import { Segmented } from '../../training/Segmented';
import { fingerPhrase, keyLabel } from '../../typing/fingerMap';
import { AirTypingJudge, isMastery, lettersFor, StrikeDetector, type JudgedLetter, type TypingScore } from '../../typing/strikes';
import { alignToLoop, botTyping, typistMotion, TYPIST_BEAT_MS } from '../../typing/typist';
import { TypingStage, type FingerMark } from '../../typing/TypingStage';
import { LEVEL_LABEL, pickWords, type TypingLevel } from '../../typing/words';
import { TestResult } from '../TestResult';
import { DUEL_PASS_SCORE, useBotSkill, useDuelOutcome } from '../useDuelOutcome';

const COUNT_IN_S = 3;
/** How long a right strike shows malachite and a wrong one vermilion, seconds. */
const OK_FLASH_S = 0.35;
const OFF_FLASH_S = 0.9;
const LEVELS: { id: TypingLevel; label: string }[] = [
  { id: 'home', label: LEVEL_LABEL.home },
  { id: 'all', label: LEVEL_LABEL.all },
];

interface Run {
  judge: AirTypingJudge;
  /** Stream time from which strikes count (the end of the count-in). */
  start: number;
  /** The simulated typist's beat in seconds, to line its strikes up with the letters. */
  beat: number;
  bot: TypingScore;
}

interface View {
  judged: number;
  last: JudgedLetter | null;
  /** Wall clock (ms) of the last settled letter, for its flash. */
  lastAt: number;
  counting: boolean;
}

/**
 * Air typing: short words appear one at a time and the learner strikes each letter in the air with the finger that owns its
 * key. The gloves feel which finger struck and when (never which key), so a letter is judged on the finger alone; the score
 * adds an even rhythm and the words per minute from the strike times. The next key is lit on the keyboard and its finger in
 * chalk on the hand; a right strike flashes malachite, a wrong finger gets vermilion.
 */
export function AirTyping({ spec, lesson }: { spec: TestSpec; lesson?: Lesson }) {
  const gloves = useGloveStream(true);
  const clock = useStreamClock(gloves);
  const [showProps] = useShowProps();
  const [margin] = useMargin();
  const botSkill = useBotSkill(lesson);
  const [level, setLevel] = useState<TypingLevel>('home');
  const [seed, setSeed] = useState(1);
  const [stage, setStage] = useState<'intro' | 'playing' | 'result'>('intro');
  const [view, setView] = useState<View>({ judged: 0, last: null, lastAt: 0, counting: false });
  const [, setTick] = useState(0);
  const words = useMemo(() => pickWords(level, Math.max(2, spec.rounds * 2), seed), [level, spec.rounds, seed]);
  const letters = useMemo(() => lettersFor(words), [words]);
  const typist = useMemo(() => typistMotion(letters), [letters]);
  const run = useRef<Run | null>(null);
  const detector = useRef(new StrikeDetector());

  // Without gloves on, the simulator types this very run (ignored by real gloves).
  useEffect(() => {
    gloves.setMotion(typist.motion);
  }, [gloves, gloves.status, typist.motion]);

  const settle = useCallback((j: JudgedLetter | null) => {
    if (!j || !run.current) return;
    setView({ judged: run.current.judge.judged.length, last: j, lastAt: performance.now(), counting: false });
  }, []);

  useEffect(
    () =>
      gloves.onFrame((f) => {
        const strikes = detector.current.push(f);
        const r = run.current;
        if (!r) return;
        for (const s of strikes) {
          if (s.t < r.start) continue;
          // The simulator strikes on a fixed beat from the loop start: a strike it made but the page never saw (sparse frames on
          // a busy page) is marked not felt, so the letters after it still line up.
          if (f.source === 'simulator') for (const j of r.judge.skipTo(Math.floor((s.t - r.start) / r.beat), s.t)) settle(j);
          settle(r.judge.push(s));
        }
      }),
    [gloves, settle],
  );

  const start = useCallback(() => {
    const after = clock.now() + COUNT_IN_S;
    const period = (letters.length * TYPIST_BEAT_MS) / 1000;
    // A simulated glove types on a loop from the stream origin: start on a loop boundary so its first strike is the first letter.
    const t0 = clock.simulated() ? alignToLoop(after, period) - 0.15 : after;
    run.current = { judge: new AirTypingJudge(letters, margin), start: t0, beat: TYPIST_BEAT_MS / 1000, bot: botTyping(letters, 7 + seed, botSkill) };
    setView({ judged: 0, last: null, lastAt: 0, counting: true });
    setStage('playing');
  }, [clock, letters, margin, seed, botSkill]);

  useEffect(() => {
    if (stage !== 'playing') return;
    const id = window.setInterval(() => {
      const r = run.current;
      if (!r) return;
      settle(r.judge.flush(clock.lastFrame()));
      if (clock.now() >= r.start) setView((v) => (v.counting ? { ...v, counting: false } : v));
      setTick((n) => n + 1);
      if (r.judge.done()) {
        window.clearInterval(id);
        window.setTimeout(() => setStage('result'), 600);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [stage, clock, settle]);

  const r = run.current;
  const finished = stage === 'result' && Boolean(r);
  const score = finished && r ? r.judge.score() : null;
  const seal = useDuelOutcome(lesson, finished, (score?.overall ?? 0) >= DUEL_PASS_SCORE, score?.overall ?? 0);

  if (stage === 'result' && r && score) {
    const mastery = isMastery(score, margin);
    const verdict = score.overall > r.bot.overall ? 'win' : score.overall < r.bot.overall ? 'lose' : 'draw';
    const wrong = r.judge.judged.filter((j) => !j.ok);
    const worst = mostCommonSlip(wrong);
    return (
      <TestResult
        title={`Air typing, ${LEVEL_LABEL[level].toLowerCase()}`}
        score={score.overall}
        scoreLabel={`Your score against ${r.bot.overall} for the bot typist`}
        verdict={verdict}
        verdictText={verdict === 'win' ? (mastery ? 'You beat the bot typist' : 'Ahead of the bot typist') : verdict === 'draw' ? 'A draw' : 'The bot typist wins'}
        bestMoment={score.streak > 2 ? `${score.streak} letters in a row with the right finger` : ''}
        footer={seal}
        details={
          <ul className="ap-result__split" aria-label="Score breakdown">
            <li>
              <strong>{score.fingering}</strong> right finger
            </li>
            <li>
              <strong>{score.rhythm}</strong> even rhythm
            </li>
            <li>
              <strong>{score.wpm}</strong> words per minute
            </li>
            <li>{worst ? `Most often ${worst}` : 'Every letter on its own finger'}</li>
          </ul>
        }
        onAgain={() => {
          run.current = null;
          setSeed((s) => s + 1);
          setStage('intro');
        }}
      />
    );
  }

  const current = stage === 'playing' && r ? r.judge.current() : null;
  const now = performance.now();
  const last = view.last;
  const lastAge = (now - view.lastAt) / 1000;
  const marks: Record<Side, Partial<Record<Finger, FingerMark>>> = { left: {}, right: {} };
  if (current) marks[current.expected.side][current.expected.finger] = 'cue';
  if (last?.ok && last.used && lastAge < OK_FLASH_S) marks[last.used.side][last.used.finger] = 'ok';
  if (last && !last.ok && last.used && lastAge < OFF_FLASH_S) marks[last.used.side][last.used.finger] = 'off';
  const good = last && last.ok && lastAge < OK_FLASH_S ? last.letter.char : null;
  const wordIndex = current ? current.word : Math.max(0, words.length - 1);
  const shownLetters = r ? r.judge.letters.filter((l) => l.word === wordIndex && l.char !== ' ') : [];
  const judgedBy = new Map(r?.judge.judged.map((j) => [j.letter.index, j.ok]) ?? []);

  return (
    <div className="ap-arena ty-arena">
      <div className="ap-arena__scene">
        <TypingStage
          solid={showProps}
          target={stage === 'playing' ? (current?.char ?? null) : 'f'}
          good={good}
          hands={{ left: { live: gloves.latest, marks: marks.left }, right: { live: gloves.latest, marks: marks.right } }}
          label={`Your two wooden hands over a ${showProps ? 'keyboard' : 'keyboard sketched in chalk'}${current ? `; strike ${keyLabel(current.char)} with your ${fingerPhrase(current.expected)}` : ''}`}
        />
        {stage === 'playing' && r && (
          <div className="ty-word" role="status" aria-live="polite">
            <span className="ty-word__count">
              Word {wordIndex + 1} of {words.length}
            </span>
            <span className="ty-word__letters" aria-label={words[wordIndex]}>
              {shownLetters.map((l) => {
                const ok = judgedBy.get(l.index);
                const cls = ok === true ? 'ty-letter--ok' : ok === false ? 'ty-letter--off' : l.index === current?.index ? 'ty-letter--now' : '';
                return (
                  <span key={l.index} className={`ty-letter ${cls}`}>
                    {l.char.toUpperCase()}
                  </span>
                );
              })}
            </span>
            <span className="ty-word__finger">
              {view.counting
                ? 'Hands on the home row. Get ready.'
                : current
                  ? `${keyLabel(current.char)}: ${fingerPhrase(current.expected)}`
                  : 'Done'}
            </span>
          </div>
        )}
        {stage === 'playing' && last && !last.ok && lastAge < OFF_FLASH_S * 2 && (
          <p className={`ty-callout ${last.used ? 'ty-callout--off' : ''}`} aria-live="polite">
            {last.used
              ? `${keyLabel(last.letter.char)} is your ${fingerPhrase(last.letter.expected)}, not your ${fingerPhrase(last.used)}`
              : `${keyLabel(last.letter.char)}: the gloves felt no strike`}
          </p>
        )}
        {stage === 'intro' && (
          <Card as="section" className="ap-intro" aria-label="How to play">
            <h2>Air typing</h2>
            <ul className="ap-intro__rules">
              <li>Short words appear one at a time. Strike each letter in the air with the finger that owns its key; the space between words is your thumb.</li>
              <li>The gloves feel which finger struck and when, not which key it would land on, so every letter is judged on the finger.</li>
              <li>Your score is the right finger per letter, an even rhythm, and your words per minute. Beat the bot typist.</li>
            </ul>
            <Segmented label="Words" value={level} options={LEVELS} onChange={setLevel} />
            <div className="ap-intro__foot">
              <PropSwitch prop="keyboard" className="ap-intro__prop" />
              <Button large onClick={start}>
                Start typing
              </Button>
            </div>
          </Card>
        )}
      </div>
      {stage === 'playing' && r && (
        <p className="ty-live">
          <span>
            <strong className="ap-num">{r.judge.score().fingering}</strong> right finger
          </span>
          <span>
            <strong className="ap-num">{r.judge.score().wpm}</strong> words per minute
          </span>
          <span>
            Bot typist <strong className="ap-num">{r.bot.overall}</strong>
          </span>
        </p>
      )}
    </div>
  );
}

/** "the left middle finger for D": the slip the learner made most, for the result card. */
function mostCommonSlip(wrong: JudgedLetter[]): string {
  if (!wrong.length) return '';
  const counts = new Map<string, number>();
  for (const j of wrong) {
    const k = j.used ? `the ${fingerPhrase(j.used)} for ${keyLabel(j.letter.char)}` : `no strike felt for ${keyLabel(j.letter.char)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
