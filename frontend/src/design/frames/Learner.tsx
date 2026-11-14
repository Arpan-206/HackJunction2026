import { useEffect, useMemo, useRef, useState } from 'react';
import { Hand, Keyboard, Racket, type HandHandle } from '../../three';
import { Frame, Key, Primary, Tick } from '../kit';
import { SKILL_POSES, SWING, pose } from '../poses';
import { SceneCanvas, play } from '../scene';
import { useStills, type StillJob } from '../Stills';

type Level = 'Beginner' | 'Intermediate' | 'Advanced';
interface Skill {
  id: keyof typeof SKILL_POSES;
  name: string;
  level: Level;
  hands: 'One hand' | 'Two hands';
  live: boolean;
  progress?: { lesson: number; of: number; pct: number };
}

const SKILLS: Skill[] = [
  { id: 'tableTennis', name: 'Table tennis', level: 'Beginner', hands: 'One hand', live: true, progress: { lesson: 2, of: 4, pct: 35 } },
  { id: 'piano', name: 'Piano', level: 'Intermediate', hands: 'Two hands', live: true, progress: { lesson: 1, of: 5, pct: 22 } },
  { id: 'spelling', name: 'Finnish fingerspelling', level: 'Intermediate', hands: 'One hand', live: false },
  { id: 'shadow', name: 'Shadow puppets', level: 'Beginner', hands: 'Two hands', live: false },
];

type Cam = StillJob['camera'];
const UPRIGHT: Cam = { position: [1.4, 1.5, 4.6], target: [0, 0.35, -0.4] };
const CARD_CAMS: Partial<Record<Skill['id'], Cam>> = {
  piano: { position: [0, 3.4, 3.4], target: [0, -0.45, -1.3] },
  tableTennis: { position: [2.2, 2.4, 3.9], target: [-0.3, 0, -0.6] },
  spelling: UPRIGHT,
  shadow: { position: [1.3, 2.0, 4.4], target: [0.1, 0.2, -0.3] },
};

function sceneFor(id: Skill['id']): StillJob['scene'] {
  const p = SKILL_POSES[id];
  switch (id) {
    case 'tableTennis':
      return (
        <Hand style="chalk" frame={p} position={[0, 0.3, -0.5]} rotation={[0, 1.2, 0]}>
          <Racket />
        </Hand>
      );
    case 'piano':
      return (
        <>
          <Keyboard keys={15} activeKey={9} />
          <Hand style="chalk" side="left" frame={pose([0.1, 0.25, 0.1, 0.12, 0.1], [0, 0, 0], 'left')} position={[-0.95, 0, 0]} />
          <Hand style="chalk" side="right" frame={p} position={[0.95, 0, 0]} />
        </>
      );
    case 'shadow':
      return (
        <>
          <Hand style="chalk" frame={p} position={[-0.2, 0.25, -0.2]} />
          <Hand style="chalk" side="left" frame={pose([0.1, 0.9, 0.95, 0.95, 0.95], [0, 0.2, 0.3], 'left')} position={[0.6, 0.05, 0.4]} scale={0.8} />
        </>
      );
    default:
      return <Hand style="chalk" frame={p} position={[0, id === 'spelling' ? 0.1 : 0, 0]} />;
  }
}

function useQuery(): string {
  return useMemo(() => new URLSearchParams(window.location.search).get('q') ?? '', []);
}

/** 2a-2c. Skill dashboard: Today, search with "/", quiet filters, and skill cards rendered from one shared canvas. */
export function LearnerHome() {
  const initial = useQuery();
  const [q, setQ] = useState(initial);
  const [level, setLevel] = useState<'All' | Level>('All');
  const [hands, setHands] = useState<'Any' | 'One hand' | 'Two hands'>('Any');
  const search = useRef<HTMLInputElement>(null);
  const jobs = useMemo<StillJob[]>(
    () => SKILLS.map((s) => ({ id: s.id, scene: sceneFor(s.id), camera: CARD_CAMS[s.id] })),
    [],
  );
  const { urls, host } = useStills(jobs);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== search.current) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = SKILLS.filter((s) => (!q || s.name.toLowerCase().includes(q.toLowerCase())) && (level === 'All' || s.level === level) && (hands === 'Any' || s.hands === hands));
  return (
    <Frame world="field" active="learner" title="Your skills" sub="Learn a hand skill from an expert's hand" className="dz--home">
      {host}
      <div className="dz-home">
        {!q && (
          <section className="dz-today" aria-labelledby="today-h">
            <div className="dz-today__text">
              <h2 id="today-h">Today</h2>
              <p className="dz-today__what">
                <b>Piano, lesson 1: C major scale.</b> Step 2 of 4, about 8 minutes.
              </p>
              <p className="dz-today__streak">4 days in a row. One more rep keeps the candle lit.</p>
            </div>
            <Primary k="Enter">Continue</Primary>
          </section>
        )}
        <div className="dz-find">
          <label className="dz-search">
            <span className="sr-only">Search skills</span>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5 21 21" />
            </svg>
            <input ref={search} type="search" placeholder="Search skills" value={q} onChange={(e) => setQ(e.target.value)} />
            <Key>/</Key>
          </label>
          <div className="dz-filter" role="group" aria-label="Level">
            <span>Level</span>
            {(['All', 'Beginner', 'Intermediate', 'Advanced'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>
                {l}
              </button>
            ))}
          </div>
          <div className="dz-filter" role="group" aria-label="Hands">
            <span>Hands</span>
            {(['Any', 'One hand', 'Two hands'] as const).map((h) => (
              <button key={h} type="button" aria-pressed={hands === h} onClick={() => setHands(h)}>
                {h === 'Any' ? 'Any' : h === 'One hand' ? 'One' : 'Two'}
              </button>
            ))}
          </div>
        </div>
        {q && shown.length > 0 && (
          <p className="dz-count" role="status">
            {shown.length} {shown.length === 1 ? 'skill matches' : 'skills match'} &ldquo;{q}&rdquo;.{' '}
            <button type="button" className="dz-link" onClick={() => setQ('')}>
              Clear search
            </button>
          </p>
        )}
        {shown.length === 0 ? (
          <section className="dz-none" role="status">
            <h2>No skill called &ldquo;{q}&rdquo; yet</h2>
            <p>Skills appear here when an expert records them. Try a shorter word, or one of the live skills.</p>
            <div className="dz-none__try">
              <button type="button" className="btn btn--secondary" onClick={() => setQ('table')}>
                Table tennis
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setQ('piano')}>
                Piano
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setQ('')}>
                Clear search <Key>Esc</Key>
              </button>
            </div>
          </section>
        ) : (
          <ul className="dz-cards" aria-label="Skills">
            {shown.map((s) => (
              <li key={s.id} className={`dz-card ${s.live ? '' : 'is-workshop'}`}>
                <a href="#" onClick={(e) => e.preventDefault()} aria-disabled={!s.live || undefined}>
                  <span className="dz-card__img">{urls[s.id] ? <img src={urls[s.id]} alt="" /> : <span className="dz-card__wait" />}</span>
                  <span className="dz-card__body">
                    <b className="dz-card__name">{s.name}</b>
                    <span className="dz-card__meta">
                      {s.level}, {s.hands.toLowerCase()}
                    </span>
                    {s.live && s.progress ? (
                      <span className="dz-card__prog">
                        <span>
                          Lesson {s.progress.lesson} of {s.progress.of}
                        </span>
                        <span className="dz-bar" aria-hidden="true">
                          <span style={{ width: `${s.progress.pct}%` }} />
                        </span>
                      </span>
                    ) : (
                      <span className="dz-card__soon">In the workshop, being recorded</span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Frame>
  );
}

/** 2d. Skill page: a large 3D showcase replaying lessons 1 and 2, one Continue action and the lesson list. */
export function SkillPage() {
  const hand = useRef<HandHandle>(null);
  return (
    <Frame world="field" active="learner" title="Table tennis" sub="From the hand of Maestra Lucia Ferri">
      <div className="dz-body dz-body--skill">
        <section className="dz-stage dz-stage--show" aria-label="Showcase">
          <SceneCanvas world="bench" position={[2.9, 2.7, 4.9]} target={[-0.3, -0.05, -0.8]} bench={{ circle: 1.5 }} label="The expert's chalk hand replaying the forehand swing with a racket on the walnut bench">
            <Hand ref={hand} style="chalk" side="right" position={[0, 0.3, -0.6]} rotation={[0, 1.2, 0]} getFrame={play(SWING, 0.95)}>
              <Racket />
            </Hand>
          </SceneCanvas>
          <div className="dz-chapters" aria-label="Showcase chapters">
            <button type="button" className="dz-chapters__play" aria-label="Pause the showcase">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" />
              </svg>
            </button>
            <div className="dz-chapters__track">
              <span className="dz-chapters__seg is-done" style={{ flexGrow: 12 }}>
                <span className="dz-chapters__fill" style={{ width: '100%' }} />
                <b>1 Shakehand grip</b>
              </span>
              <span className="dz-chapters__seg is-now" style={{ flexGrow: 18 }}>
                <span className="dz-chapters__fill" style={{ width: '42%' }} />
                <b>2 Forehand swing</b>
              </span>
            </div>
            <span className="dz-chapters__time">0:19 / 0:30</span>
          </div>
        </section>
        <aside className="dz-panel" aria-label="About this skill">
          <p className="dz-body-text">Hold the racket like a handshake and swing from the forearm. Four short lessons, each scored finger by finger against the expert&rsquo;s hand.</p>
          <dl className="dz-facts dz-facts--row">
            <div>
              <dt>Level</dt>
              <dd>Beginner</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>25 min</dd>
            </div>
            <div>
              <dt>Hands</dt>
              <dd>One hand</dd>
            </div>
          </dl>
          <Primary k="Enter">Continue lesson 2</Primary>
          <ol className="dz-lessons" aria-label="Lessons">
            <li className="is-done">
              <span className="dz-lessons__n">
                <Tick />
              </span>
              <span>
                <b>Shakehand grip</b>
                <span>5 of 5 steps learned</span>
              </span>
            </li>
            <li className="is-now">
              <span className="dz-lessons__n">2</span>
              <span>
                <b>Forehand swing</b>
                <span>2 of 5 steps learned</span>
                <span className="dz-bar" aria-hidden="true">
                  <span style={{ width: '40%' }} />
                </span>
              </span>
            </li>
            <li className="is-locked">
              <span className="dz-lessons__n">3</span>
              <span>
                <b>Backhand push</b>
                <span>Opens after lesson 2</span>
              </span>
            </li>
            <li className="is-locked">
              <span className="dz-lessons__n">4</span>
              <span>
                <b>Rally against the bot</b>
                <span>Test your skills, opens after lesson 3</span>
              </span>
            </li>
          </ol>
        </aside>
      </div>
    </Frame>
  );
}
