import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useGloveStream, type GloveFrame, type HandFrame, type ScoreResult } from '../../api';
import { MARGIN_MULTIPLIERS } from '../../api/margin';
import { FINGERS } from '../../api/types';
import { Button } from '../../components/ui';
import { frameAt } from '../../mock/synth';
import { Hand, HandCanvas, synthFrame, type HandProps } from '../../three';
import { ApHeader } from '../apprentice/ApHeader';
import { flexionDegrees } from '../apprentice/training/coach/deviation';
import { Segmented } from '../apprentice/training/Segmented';
import { skillPath } from '../apprentice/skills/catalogue';
import { useMargin } from '../shared/settings';
import { CHART, DRILL_WORDS, gloveTwins, letterShape, LETTER_MS, SOURCES, spellable, twinGroups, twinReason, wordMotion, type Letter, type LetterShape } from './chart';
import { DEFAULT_DRILL, drillFrame, holdProgress, skipLetter, startDrill, summarise, type DrillState } from './drill';
import './fingerspelling.css';

type Tab = 'drill' | 'chart';
const TABS: { id: Tab; label: string }[] = [
  { id: 'drill', label: 'Spell a word' },
  { id: 'chart', label: 'Letter chart' },
];
/** Angle tolerance of the seeded letter lessons, degrees, before the learner's margin. */
const LETTER_TOLERANCE_DEG = 22;
/** Letters are read face on: the hand stands up, palm to the viewer, as a signer shows it. */
const EXPERT_CAMERA: [number, number, number] = [-0.8, 0.45, 4.4];
const LEARNER_CAMERA: [number, number, number] = [0.8, 0.45, 4.4];
const HAND_TARGET: [number, number, number] = [0, 0.2, 0];

/** A hand stood upright, palm towards the camera: fingers from forward (-Z) to up, then turned to face the viewer. */
function UprightHand(props: HandProps) {
  return (
    <group rotation={[0, Math.PI, 0]} position={[0, -0.85, 0]}>
      <Hand {...props} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}
const FINGER_WORD: Record<string, string> = { thumb: 'thumb', index: 'index finger', middle: 'middle finger', ring: 'ring finger', little: 'little finger' };

function rightHand(f: GloveFrame | null): HandFrame | null {
  return f?.hands.find((h) => h.side === 'right') ?? null;
}

/**
 * /apprentice/fingerspelling: the word drill and the letter chart. The drill spells a word letter by letter: the expert's
 * chalk hand shows the letter, the learner's wooden hand follows the glove, and each letter passes after a clean hold with
 * a live match. The whole word is then scored by the scorer against the expert's spelling. The chart lists all 26 letters
 * with the shape the gloves read and the letters they cannot tell apart.
 */
export default function FingerspellingScreen() {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') === 'chart' ? 'chart' : 'drill'));
  return (
    <div className="fs-page">
      <ApHeader title="Fingerspelling" context="The American manual alphabet, letter by letter" back={{ to: skillPath('fingerspelling'), label: 'Back to the skill' }} />
      <Segmented label="Fingerspelling view" value={tab} options={TABS} onChange={setTab} />
      {tab === 'drill' ? <Drill /> : <Chart />}
    </div>
  );
}

/* ---------- the word drill ---------- */

type Phase = 'pick' | 'running' | 'scoring' | 'result';

function Drill() {
  const gloves = useGloveStream(true);
  const [margin] = useMargin();
  const cfg = useMemo(() => ({ ...DEFAULT_DRILL, toleranceDeg: LETTER_TOLERANCE_DEG * MARGIN_MULTIPLIERS[margin] }), [margin]);
  const [word, setWord] = useState(DRILL_WORDS[0]);
  const [phase, setPhase] = useState<Phase>('pick');
  const [view, setView] = useState<DrillState | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const state = useRef<DrillState | null>(null);
  const frames = useRef<GloveFrame[]>([]);
  const letterT0 = useRef(0);
  const letters = useMemo(() => spellable(word), [word]);
  const current: LetterShape | null = view && !view.done ? letterShape(view.word[view.index]) : null;

  // The simulated glove (mock mode, the backend simulator) forms the letter the drill asks for; real gloves ignore this.
  useEffect(() => {
    if (current) gloves.setMotion(current.motion);
  }, [current, gloves]);

  const finish = useCallback(
    async (s: DrillState) => {
      setView(s);
      setPhase('scoring');
      const attempt = frames.current.slice();
      try {
        if (attempt.length < 3) throw new Error('no glove frames arrived');
        const res = await api.score({
          reference_motion: wordMotion(s.word.join('')),
          attempt_frames: attempt,
          tolerance: { angle_deg: LETTER_TOLERANCE_DEG, timing_ms: LETTER_MS },
          margin,
          side: 'right',
        });
        setScore(res);
        setProblem(null);
      } catch (e) {
        setScore(null);
        setProblem(`The word could not be scored (${e instanceof Error ? e.message : 'unknown error'}). The letters below are the live match.`);
      }
      setPhase('result');
    },
    [margin],
  );

  useEffect(() => {
    if (phase !== 'running') return;
    const off = gloves.onFrame((f) => {
      const s = state.current;
      const hand = rightHand(f);
      if (!s || s.done || !hand) return;
      frames.current.push(f);
      const shape = letterShape(s.word[s.index]) as LetterShape;
      const now = performance.now();
      // The target comes from the scorer's own synthesiser (mock/synth.ts, the port of the backend's), not the preview one
      // in three/motion.ts, whose thumb sits up to 26 degrees off it (STATUS-shadows.md). The live match then agrees with the
      // score the word gets at the end.
      const target = flexionDegrees(frameAt(shape.motion, (now - letterT0.current) / 1000, ['right']).hands[0]);
      const next = drillFrame(s, flexionDegrees(hand), target, now, cfg);
      if (next.index !== s.index) letterT0.current = now;
      state.current = next;
      if (next.done) void finish(next);
    });
    // Render the drill at 10 Hz; frames arrive faster than the eye needs.
    const id = window.setInterval(() => setView(state.current), 100);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [phase, gloves, cfg, finish]);

  const start = () => {
    if (!letters.length) return;
    const now = performance.now();
    frames.current = [];
    letterT0.current = now;
    state.current = startDrill(letters, now);
    setView(state.current);
    setScore(null);
    setProblem(null);
    setPhase('running');
  };
  const skip = () => {
    if (!state.current) return;
    const now = performance.now();
    state.current = skipLetter(state.current, now);
    letterT0.current = now;
    setView(state.current);
    if (state.current.done) void finish(state.current);
  };

  if (phase === 'pick') {
    return (
      <section className="card fs-panel" aria-label="Pick a word">
        <h2 className="fs-panel__title">Spell a word</h2>
        <p className="fs-note">
          The expert's hand shows each letter. Make the shape and hold it for {DEFAULT_DRILL.holdMs / 1000} s; the next letter follows. The whole word is scored at the end.
        </p>
        <div className="fs-words" role="group" aria-label="Words">
          {DRILL_WORDS.map((w) => (
            <Button key={w} variant={w === word ? 'primary' : 'secondary'} onClick={() => setWord(w)} aria-pressed={w === word}>
              {w}
            </Button>
          ))}
        </div>
        <label className="fs-field">
          <span>Or type a word</span>
          <input className="fs-input" value={word} maxLength={16} onChange={(e) => setWord(e.target.value.toUpperCase())} aria-label="Word to spell" />
        </label>
        {letters.length !== [...word.replace(/\s/g, '')].length && <p className="fs-note">Only the letters A to Z are spelt; the rest is skipped.</p>}
        <Button large disabled={!letters.length} onClick={start}>
          Spell {letters.join('') || 'a word'}
        </Button>
      </section>
    );
  }

  const s = view as DrillState;
  const progress = holdProgress(s, performance.now(), cfg);
  return (
    <div className="fs-drill">
      <ol className="fs-strip" aria-label={`Spelling ${s.word.join('')}`}>
        {s.word.map((l, i) => {
          const r = s.results[i];
          const cls = r ? (r.passed ? 'fs-strip__l--ok' : 'fs-strip__l--miss') : i === s.index ? 'fs-strip__l--now' : '';
          return (
            <li key={i} className={`fs-strip__l ${cls}`} aria-current={i === s.index && !r ? 'step' : undefined}>
              {l}
            </li>
          );
        })}
      </ol>

      {phase === 'running' && current && (
        <div className="fs-stage">
          <figure className="fs-stage__pane">
            <figcaption className="fs-stage__cap">The expert</figcaption>
            <HandCanvas stage={{ cameraPosition: EXPERT_CAMERA, target: [...HAND_TARGET] }} label={`The expert's hand making the letter ${current.letter}`}>
              <UprightHand side="right" style="chalk" getFrame={() => synthFrame(current.motion, (performance.now() - letterT0.current) / 1000, 'right')} />
            </HandCanvas>
          </figure>
          <div className="fs-now" aria-live="polite">
            <span className="fs-now__letter" style={{ ['--hold' as string]: `${Math.round(progress * 360)}deg` }}>
              {current.letter}
            </span>
            <p className="fs-now__shape">{current.shape}</p>
            {current.movement && <p className="fs-now__move">{current.movement}</p>}
            <p className="fs-now__match">
              Match <span className="ap-num">{s.match}</span>
            </p>
            <p className={s.off.length ? 'fs-now__fix' : 'fs-now__ok'}>{s.off.length ? `Fix your ${s.off.map((f) => FINGER_WORD[f]).join(', ')}.` : 'Every finger is in place. Hold it.'}</p>
            <div className="fs-actions">
              <Button variant="secondary" onClick={skip}>
                Skip this letter
              </Button>
            </div>
          </div>
          <figure className="fs-stage__pane">
            <figcaption className="fs-stage__cap">You</figcaption>
            <HandCanvas stage={{ cameraPosition: LEARNER_CAMERA, target: [...HAND_TARGET] }} label="Your wooden hand, following the glove">
              <UprightHand side="right" style="wood" live={gloves.latest} />
            </HandCanvas>
          </figure>
        </div>
      )}

      {phase === 'scoring' && <p className="fs-note">Scoring your spelling...</p>}

      {phase === 'result' && (
        <section className="card fs-panel" aria-label={`Score for ${s.word.join('')}`}>
          <h2 className="fs-panel__title">{s.word.join('')}</h2>
          {score && (
            <p className="fs-score" aria-label={`Overall score ${Math.round(score.overall)} out of 100`}>
              <span className="fs-score__n">{Math.round(score.overall)}</span> out of 100
            </p>
          )}
          {problem && <p className="fs-note">{problem}</p>}
          <DrillTable state={s} />
          {score && <p className="fs-note">{score.hint}</p>}
          <div className="fs-actions">
            <Button onClick={start}>Spell it again</Button>
            <Button variant="secondary" onClick={() => setPhase('pick')}>
              Pick another word
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function DrillTable({ state }: { state: DrillState }) {
  const sum = summarise(state.results);
  return (
    <>
      <table className="fs-table">
        <caption className="fs-table__cap">
          {sum.passed} of {sum.total} letters held cleanly, mean match {sum.match}
          {sum.lettersPerMinute ? `, ${sum.lettersPerMinute} letters a minute` : ''}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Letter</th>
            <th scope="col">Time (s)</th>
            <th scope="col">Match</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {state.results.map((r, i) => (
            <tr key={i} className={r.passed ? '' : 'fs-table__miss'}>
              <th scope="row">{r.letter}</th>
              <td className="ap-num">{(r.ms / 1000).toFixed(1)}</td>
              <td className="ap-num">{r.match}</td>
              <td>{r.passed ? 'Held' : 'Missed'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sum.hardest && <p className="fs-note">Practise {sum.hardest} next: it had the lowest match.</p>}
    </>
  );
}

/* ---------- the letter chart ---------- */

function CurlBars({ shape }: { shape: LetterShape }) {
  return (
    <div className="fs-bars" role="img" aria-label={`Curl, thumb to little finger: ${FINGERS.map((f) => Math.round(shape.curls[f] * 100)).join(', ')} percent`}>
      {FINGERS.map((f) => (
        <span key={f} className="fs-bars__bar" style={{ ['--curl' as string]: shape.curls[f] }} title={`${FINGER_WORD[f]}: ${Math.round(shape.curls[f] * 100)}% curled`} />
      ))}
    </div>
  );
}

/** The line under a chart card: whether the letter moves and which letters the gloves read it as. */
function cardNote(moves: boolean, twins: Letter[]): string {
  const like = twins.length ? `Reads like ${twins.join(', ')}` : '';
  if (moves) return like ? `Moves. ${like}` : 'Moves';
  return like || 'The gloves see it clearly';
}

function Chart() {
  const [picked, setPicked] = useState<Letter>('A');
  const shape = letterShape(picked) as LetterShape;
  const twins = gloveTwins(picked);
  return (
    <div className="fs-chart">
      <section className="card fs-panel fs-chart__pick" aria-label={`The letter ${picked}`}>
        <div className="fs-chart__hand">
          <HandCanvas stage={{ cameraPosition: EXPERT_CAMERA, target: [...HAND_TARGET] }} label={`The expert's hand making the letter ${picked}`}>
            <UprightHand side="right" style="chalk" motion={shape.motion} />
          </HandCanvas>
        </div>
        <div>
          <h2 className="fs-chart__big">{picked}</h2>
          <p className="fs-now__shape">{shape.shape}</p>
          {shape.movement && <p className="fs-now__move">{shape.movement}</p>}
          {twins.length ? (
            <ul className="fs-twins">
              {twins.map((t) => (
                <li key={t}>
                  <strong>Reads like {t}.</strong> {twinReason(picked, t)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="fs-note">The gloves can tell this letter from every other by its curls.</p>
          )}
        </div>
      </section>

      <ul className="fs-grid" aria-label="The 26 letters">
        {CHART.map((c) => {
          const tw = gloveTwins(c.letter);
          return (
            <li key={c.letter}>
              <button type="button" className={`fs-card${c.letter === picked ? ' fs-card--on' : ''}`} onClick={() => setPicked(c.letter)} aria-pressed={c.letter === picked}>
                <span className="fs-card__letter">{c.letter}</span>
                <CurlBars shape={c} />
                <span className="fs-card__note">{cardNote(c.movement !== null, tw)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <section className="card fs-panel" aria-label="What the gloves cannot see">
        <h2 className="fs-panel__title">Letters the gloves read alike</h2>
        <p className="fs-note">The gloves measure how far each finger curls and how the wrist turns. They do not measure finger spread or which finger the thumb touches, so these groups look the same to the scorer. The expert's hand still shows the difference.</p>
        <ul className="fs-groups">
          {twinGroups().map((g) => (
            <li key={g.join('')}>{g.join(', ')}</li>
          ))}
        </ul>
        <p className="fs-note">
          Handshapes from{' '}
          {SOURCES.map((s, i) => (
            <span key={s.url}>
              {i > 0 && (i === SOURCES.length - 1 ? ' and ' : ', ')}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            </span>
          ))}
          . The curl of each finger is an estimate until an expert records the letters with the gloves.
        </p>
      </section>
    </div>
  );
}
