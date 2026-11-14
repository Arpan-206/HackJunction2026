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
import { LETTER_MS, type Curls } from './chart';
import { DEFAULT_DRILL, drillFrame, holdProgress, skipLetter, startDrill, summarise, type DrillState } from './drill';
import {
  curlsLabel,
  DEFAULT_PACK_ID,
  NOT_RECORDED,
  packTwinGroups,
  packTwinReason,
  packTwins,
  planMotion,
  scorable,
  skipReason,
  spellPlan,
  usePacks,
  type PackLetterView,
  type PackView,
  type PlanItem,
} from './packs';
import './fingerspelling.css';

type Tab = 'drill' | 'chart';
const TABS: { id: Tab; label: string }[] = [
  { id: 'drill', label: 'Spell a word' },
  { id: 'chart', label: 'Letter chart' },
];
/** Angle tolerance of the seeded letter lessons, degrees, before the learner's margin. */
const LETTER_TOLERANCE_DEG = 22;
/** Words offered first, per pack. The Finnish ones use only the pack's slots. */
const PACK_WORDS: Record<string, string[]> = {
  asl: ['JUNCTION', 'GEPPETTO', 'HELLO', 'HAND', 'ROBOT'],
  fi: ['SUOMI', 'SUSI', 'MÖSSÖ', 'ÄITI'],
};
/** Letters many keyboards lack, offered as buttons under the word box. */
const EXTRA_LETTERS = ['Å', 'Ä', 'Ö'];
/** Letters are read face on: the hand stands up, palm to the viewer, as a signer shows it. */
const EXPERT_CAMERA: [number, number, number] = [-0.8, 0.45, 4.4];
const LEARNER_CAMERA: [number, number, number] = [0.8, 0.45, 4.4];
const HAND_TARGET: [number, number, number] = [0, 0.2, 0];
const RECORD_HOW = 'A person records it from the chart with the slot kit (scripts/slot/run.sh --only 9) or the camera (python -m core --camera).';

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
 * /apprentice/fingerspelling: the word drill and the letter chart, for one fingerspelling pack at a time (the ASL
 * fingerspelling alphabet, or Finnish fingerspelling as a person records it). The drill spells a word letter by letter: the
 * expert's chalk hand shows each recorded letter, the learner's wooden hand follows the glove, each letter passes after a
 * clean hold, and the scorer scores the word. A letter that is not recorded yet is flagged and skipped, never scored.
 */
export default function FingerspellingScreen() {
  const query = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState<Tab>(() => (query.get('tab') === 'chart' ? 'chart' : 'drill'));
  const { packs, offline } = usePacks();
  const [packId, setPackId] = useState(() => query.get('pack') ?? DEFAULT_PACK_ID);
  const view = packs.find((p) => p.pack.id === packId) ?? packs[0];
  return (
    <div className="fs-page">
      <ApHeader title="Fingerspelling" context={view ? `${view.pack.name}, letter by letter` : undefined} back={{ to: skillPath('fingerspelling'), label: 'Back to the skill' }} />
      {offline && <p className="note ap-banner">Backend offline: showing the built-in packs.</p>}
      {packs.length > 1 && <Segmented label="Fingerspelling pack" value={view.pack.id} options={packs.map((p) => ({ id: p.pack.id, label: p.pack.name }))} onChange={setPackId} />}
      <Segmented label="Fingerspelling view" value={tab} options={TABS} onChange={setTab} />
      {view && (tab === 'drill' ? <Drill key={view.pack.id} view={view} /> : <Chart key={view.pack.id} view={view} />)}
    </div>
  );
}

/* ---------- the word drill ---------- */

type Phase = 'pick' | 'running' | 'scoring' | 'result';

function Drill({ view }: { view: PackView }) {
  const gloves = useGloveStream(true);
  const [margin] = useMargin();
  const cfg = useMemo(() => ({ ...DEFAULT_DRILL, toleranceDeg: LETTER_TOLERANCE_DEG * MARGIN_MULTIPLIERS[margin] }), [margin]);
  const words = PACK_WORDS[view.pack.id] ?? [];
  const [word, setWord] = useState(words[0] ?? '');
  const [phase, setPhase] = useState<Phase>('pick');
  const [state, setState] = useState<DrillState | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef<DrillState | null>(null);
  const frames = useRef<GloveFrame[]>([]);
  const letterT0 = useRef(0);
  const plan = useMemo(() => spellPlan(word, view), [word, view]);
  const recorded = useMemo(() => plan.filter((p) => p.kind === 'recorded'), [plan]);
  const skipped = plan.filter((p) => p.kind !== 'recorded');
  const [ran, setRan] = useState<PlanItem[]>([]);
  const current: PackLetterView | null = state && !state.done ? (ran[state.index]?.view ?? null) : null;

  // The simulated glove (mock mode, the backend simulator) forms the letter the drill asks for; real gloves ignore this.
  useEffect(() => {
    if (current?.motion) gloves.setMotion(current.motion);
  }, [current, gloves]);

  const finish = useCallback(
    async (s: DrillState, items: PlanItem[]) => {
      setState(s);
      setPhase('scoring');
      const attempt = frames.current.slice();
      try {
        if (attempt.length < 3) throw new Error('no glove frames arrived');
        const res = await api.score({
          reference_motion: planMotion(items),
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
      const s = live.current;
      const hand = rightHand(f);
      if (!s || s.done || !hand) return;
      const item = ran[s.index]?.view ?? null;
      if (!scorable(item)) return;
      frames.current.push(f);
      const now = performance.now();
      // The target comes from the scorer's own synthesiser (mock/synth.ts, the port of the backend's), not the preview one
      // in three/motion.ts, whose thumb sits up to 26 degrees off it. The live match then agrees with the final score.
      const target = flexionDegrees(frameAt(item.motion, (now - letterT0.current) / 1000, ['right']).hands[0]);
      const next = drillFrame(s, flexionDegrees(hand), target, now, cfg);
      if (next.index !== s.index) letterT0.current = now;
      live.current = next;
      if (next.done) void finish(next, ran);
    });
    // Render the drill at 10 Hz; frames arrive faster than the eye needs.
    const id = window.setInterval(() => setState(live.current), 100);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [phase, gloves, cfg, finish, ran]);

  const start = () => {
    if (!recorded.length) return;
    const now = performance.now();
    frames.current = [];
    letterT0.current = now;
    setRan(recorded);
    live.current = startDrill(
      recorded.map((p) => p.char),
      now,
    );
    setState(live.current);
    setScore(null);
    setProblem(null);
    setPhase('running');
  };
  const skip = () => {
    if (!live.current) return;
    const now = performance.now();
    live.current = skipLetter(live.current, now);
    letterT0.current = now;
    setState(live.current);
    if (live.current.done) void finish(live.current, ran);
  };

  if (phase === 'pick') {
    return (
      <section className="card fs-panel" aria-label="Pick a word">
        <h2 className="fs-panel__title">Spell a word in {view.pack.name}</h2>
        <p className="fs-note">
          The expert's hand shows each recorded letter. Make the shape and hold it for {DEFAULT_DRILL.holdMs / 1000} s; the next letter follows. The whole word is scored at the end.
          Letters that are not recorded yet are skipped and never scored.
        </p>
        {words.length > 0 && (
          <div className="fs-words" role="group" aria-label="Words">
            {words.map((w) => (
              <Button key={w} variant={w === word ? 'primary' : 'secondary'} onClick={() => setWord(w)} aria-pressed={w === word}>
                {w}
              </Button>
            ))}
          </div>
        )}
        <label className="fs-field">
          <span>Or type a word</span>
          <input className="fs-input" value={word} maxLength={16} lang="fi" onChange={(e) => setWord(e.target.value.toLocaleUpperCase('fi-FI'))} aria-label="Word to spell" />
        </label>
        <div className="fs-words" role="group" aria-label="Add a letter">
          {EXTRA_LETTERS.map((ch) => (
            <Button key={ch} variant="secondary" onClick={() => setWord((w) => (w + ch).slice(0, 16))} aria-label={`Add ${ch}`}>
              {ch}
            </Button>
          ))}
        </div>
        <PlanStrip plan={plan} />
        {skipped.length > 0 && (
          <ul className="fs-skips" aria-label="Letters skipped">
            {skipped.map((p, i) => (
              <li key={i}>{skipReason(p, view.pack.name)}</li>
            ))}
          </ul>
        )}
        {!recorded.length && plan.length > 0 && (
          <p className="fs-note">None of these letters is recorded yet in {view.pack.name}, so there is nothing to score. {RECORD_HOW}</p>
        )}
        <Button large disabled={!recorded.length} onClick={start}>
          {recorded.length ? `Spell ${recorded.map((p) => p.char).join('')}` : 'Nothing to spell yet'}
        </Button>
      </section>
    );
  }

  const s = state as DrillState;
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

      {phase === 'running' && current?.motion && (
        <div className="fs-stage">
          <figure className="fs-stage__pane">
            <figcaption className="fs-stage__cap">The expert</figcaption>
            <HandCanvas stage={{ cameraPosition: EXPERT_CAMERA, target: [...HAND_TARGET] }} label={`The expert's hand making the letter ${current.letter}`}>
              <UprightHand side="right" style="chalk" getFrame={() => synthFrame(current.motion as NonNullable<typeof current.motion>, (performance.now() - letterT0.current) / 1000, 'right')} />
            </HandCanvas>
          </figure>
          <div className="fs-now" aria-live="polite">
            <span className="fs-now__letter" style={{ ['--hold' as string]: `${Math.round(progress * 360)}deg` }}>
              {current.letter}
            </span>
            {current.shape ? <p className="fs-now__shape">{current.shape}</p> : <p className="fs-now__shape">Match the expert's recorded hand.</p>}
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
          {skipped.length > 0 && <p className="fs-note">Not scored: {skipped.map((p) => p.char).join(', ')} (not recorded yet or not in this pack).</p>}
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

/** The word as the pack spells it: recorded letters plain, unrecorded ones marked, letters outside the pack struck. */
function PlanStrip({ plan }: { plan: PlanItem[] }) {
  if (!plan.length) return null;
  return (
    <ol className="fs-strip" aria-label="How this word spells">
      {plan.map((p, i) => (
        <li key={i} className={`fs-strip__l${p.kind === 'recorded' ? '' : ' fs-strip__l--skip'}`} title={p.kind === 'recorded' ? undefined : p.kind === 'not_in_pack' ? 'Not in this pack' : NOT_RECORDED}>
          {p.char}
          {p.kind !== 'recorded' && <span className="fs-strip__why">{p.kind === 'not_in_pack' ? 'not in pack' : 'not recorded yet'}</span>}
        </li>
      ))}
    </ol>
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

function CurlBars({ curls }: { curls: Curls }) {
  return (
    <div className="fs-bars" role="img" aria-label={`Curl, thumb to little finger: ${curlsLabel(curls)} percent`}>
      {FINGERS.map((f) => (
        <span key={f} className="fs-bars__bar" style={{ ['--curl' as string]: curls[f] }} title={`${FINGER_WORD[f]}: ${Math.round(curls[f] * 100)}% curled`} />
      ))}
    </div>
  );
}

/** The line under a chart card: not recorded yet, or whether the letter moves and which letters the gloves read it as. */
function cardNote(l: PackLetterView, twins: string[]): string {
  if (!l.recorded) return NOT_RECORDED;
  const like = twins.length ? `Reads like ${twins.join(', ')}` : '';
  if (l.movement) return like ? `Moves. ${like}` : 'Moves';
  return like || 'The gloves see it clearly';
}

function RefLink({ reference }: { reference: string }) {
  const parts = reference.split(/;\s*/);
  return (
    <>
      {parts.map((r, i) => (
        <span key={r}>
          {i > 0 && ', '}
          {/^https?:\/\//.test(r) ? (
            <a href={r} target="_blank" rel="noreferrer">
              {r.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            r
          )}
        </span>
      ))}
    </>
  );
}

function Chart({ view }: { view: PackView }) {
  const first = view.letters.find((l) => l.recorded) ?? view.letters[0];
  const [picked, setPicked] = useState(first?.letter ?? '');
  const l = view.letters.find((x) => x.letter === picked) ?? first;
  const twins = l ? packTwins(view, l.letter) : [];
  const groups = packTwinGroups(view);
  const ref = view.pack.default_reference;
  return (
    <div className="fs-chart">
      <p className="fs-note">
        {view.pack.description} {view.recorded} of {view.letters.length} letters recorded.
      </p>
      {l && (
        <section className="card fs-panel fs-chart__pick" aria-label={`The letter ${l.letter}`}>
          <div className="fs-chart__hand">
            {l.motion ? (
              <HandCanvas stage={{ cameraPosition: EXPERT_CAMERA, target: [...HAND_TARGET] }} label={`The expert's hand making the letter ${l.letter}`}>
                <UprightHand side="right" style="chalk" motion={l.motion} />
              </HandCanvas>
            ) : (
              <p className="fs-chart__empty">{NOT_RECORDED}</p>
            )}
          </div>
          <div>
            <h2 className="fs-chart__big">{l.letter}</h2>
            {l.recorded ? (
              <>
                {l.shape && <p className="fs-now__shape">{l.shape}</p>}
                {l.movement && <p className="fs-now__move">{l.movement}</p>}
                <p className="fs-who">
                  Recorded by {l.recordedBy}
                  {l.recordedAt ? ` on ${l.recordedAt.slice(0, 10)}` : ''}. Reference: {l.reference ? <RefLink reference={l.reference} /> : 'none given'}.
                </p>
                {twins.length ? (
                  <ul className="fs-twins">
                    {twins.map((t) => (
                      <li key={t}>
                        <strong>Reads like {t}.</strong> {packTwinReason(view, l.letter, t)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="fs-note">The gloves can tell this letter from every other recorded letter by its curls.</p>
                )}
              </>
            ) : (
              <p className="fs-now__shape">
                {NOT_RECORDED}. {RECORD_HOW} Reference:{' '}
                <a href={ref.url} target="_blank" rel="noreferrer">
                  {ref.label}
                </a>
                .
              </p>
            )}
          </div>
        </section>
      )}

      <ul className="fs-grid" aria-label={`The letters of ${view.pack.name}`}>
        {view.letters.map((c) => (
          <li key={c.letter}>
            <button
              type="button"
              className={`fs-card${c.letter === l?.letter ? ' fs-card--on' : ''}${c.recorded ? '' : ' fs-card--empty'}`}
              onClick={() => setPicked(c.letter)}
              aria-pressed={c.letter === l?.letter}
            >
              <span className="fs-card__letter">{c.letter}</span>
              {c.curls ? <CurlBars curls={c.curls} /> : <span className="fs-bars fs-bars--none" aria-hidden="true" />}
              <span className="fs-card__note">{cardNote(c, packTwins(view, c.letter))}</span>
            </button>
          </li>
        ))}
      </ul>

      <section className="card fs-panel" aria-label="Sources and what the gloves cannot see">
        {groups.length > 0 && (
          <>
            <h2 className="fs-panel__title">Letters the gloves read alike</h2>
            <p className="fs-note">The gloves measure how far each finger curls and how the wrist turns. They do not measure finger spread or which finger the thumb touches, so these groups look the same to the scorer. The expert's hand still shows the difference.</p>
            <ul className="fs-groups">
              {groups.map((g) => (
                <li key={g.join('')}>{g.join(', ')}</li>
              ))}
            </ul>
          </>
        )}
        <p className="fs-note">
          Handshapes from{' '}
          {view.pack.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && (i === view.pack.sources.length - 1 ? ' and ' : ', ')}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            </span>
          ))}
          .{' '}
          {view.pack.id === DEFAULT_PACK_ID ? 'The curl of each finger is an estimate until an expert records the letters with the gloves.' : 'Each letter is recorded by a person holding it from the chart; none is generated or guessed.'}
        </p>
      </section>
    </div>
  );
}
