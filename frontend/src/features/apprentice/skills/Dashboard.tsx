import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../../components/PageHeader';
import { Button } from '../../../components/ui';
import { TodayPanel } from '../library/TodayPanel';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  filterSkills,
  HANDS_LABEL,
  matchReason,
  progressBar,
  skillPath,
  type Difficulty,
  type HandsNeeded,
  type SkillProgress,
  type SkillView,
} from './catalogue';
import { DifficultyLine, SkillStill } from './SkillParts';
import { SkillPreview, useLinger } from './SkillPreview';
import { prefersReducedMotion } from '../../shared/settings';
import { useSkills } from './useSkills';
import './skills.css';

/** The last search is kept for the tab only, so coming back from a skill page finds the same results. */
const QUERY_KEY = 'apprentice.skillQuery';
const SUGGESTIONS = ['grip', 'music'];

function readQuery(): string {
  try {
    return sessionStorage.getItem(QUERY_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeQuery(q: string): void {
  try {
    if (q) sessionStorage.setItem(QUERY_KEY, q);
    else sessionStorage.removeItem(QUERY_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The line above the grid: how many skills match the search, or how many pass the toggles. Empty when nothing filters. */
function countLine(shown: number, total: number, query: string, filtered: boolean): string {
  // With no match the empty state below says it in full, so the count stays quiet.
  if (!filtered || shown === 0) return '';
  const noun = shown === 1 ? 'skill' : 'skills';
  if (query) return `${shown} ${noun} ${shown === 1 ? 'matches' : 'match'} ‘${query}’`;
  return `${shown} of ${total} skills`;
}

/** True when a key press is meant for a field, so the "/" shortcut leaves typing alone. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function SkillCard({ skill, progress, query }: { skill: SkillView; progress: SkillProgress; query: string }) {
  const reason = matchReason(skill, query);
  const bar = progressBar(progress);
  // Hover (a mouse, not a tap) or keyboard focus plays the skill in the card; reduced motion keeps the still.
  const [hot, setHot] = useState(false);
  const preview = useLinger(hot && skill.live && !prefersReducedMotion());
  return (
    <li>
      <Link
        to={skillPath(skill.id)}
        className={`sk-card${skill.live ? '' : ' sk-card--workshop'}`}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHot(true)}
        onPointerLeave={() => setHot(false)}
        onFocus={() => setHot(true)}
        onBlur={() => setHot(false)}
      >
        <div className="sk-card__media">
          {skill.still ? (
            <img className="sk-card__view sk-card__img" src={skill.still.src} alt={skill.still.alt} loading="lazy" />
          ) : (
            <SkillStill className="sk-card__view" pose={skill.keyPose} scene={skill.scene} label={`${skill.name}: the expert's hand, seen over the back of the hand`} />
          )}
          {preview.mounted && <SkillPreview skill={skill} shown={preview.shown} />}
          {!skill.live && <span className="sk-card__veil" aria-hidden="true" />}
        </div>
        <div className="sk-card__body">
          <h2 className="sk-card__name">{skill.name}</h2>
          <div className="sk-card__meta">
            <DifficultyLine difficulty={skill.difficulty} />
            {skill.live ? (
              <span className={`sk-card__lessons${bar.complete ? ' sk-card__done' : ''}`}>{bar.label}</span>
            ) : (
              <span className="sk-card__workshop">In the workshop</span>
            )}
          </div>
          {skill.live && (
            <div
              className={`sk-progress${bar.complete ? ' sk-progress--done' : ''}`}
              role="progressbar"
              aria-label={`${skill.name} progress`}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={Math.min(progress.mastered, progress.total)}
              aria-valuetext={bar.label}
            >
              <span className="sk-progress__fill" style={{ width: `${bar.percent}%` }} />
            </div>
          )}
          {reason && (
            <span className="sk-card__why">
              matches &ldquo;{reason.before}
              <strong>{reason.match}</strong>
              {reason.after}&rdquo;
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

interface ToggleGroupProps<T extends string> {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T | null) => void;
}

/** A row of quiet text toggles: the chosen word is underlined and dark, the rest stay grey. "Any" clears the filter. */
function ToggleGroup<T extends string>({ label, value, options, onChange }: ToggleGroupProps<T>) {
  const all: { value: T | null; label: string }[] = [{ value: null, label: 'Any' }, ...options];
  return (
    <div className="sk-toggles" role="group" aria-label={label}>
      <span className="sk-toggles__label" aria-hidden="true">
        {label}
      </span>
      {all.map((o) => (
        <button key={o.label} type="button" className="sk-toggle" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The learner dashboard: the Today panel, a search bar with difficulty and hands toggles, then every skill as a card in a
 * wrapping grid. Live skills (lessons from the API) open a skill page to practise; workshop skills are dimmed.
 */
export function Dashboard() {
  const { skills, courses, lessons, loading, error, offline, reload, progressOf } = useSkills();
  const [query, setQueryState] = useState(readQuery);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [hands, setHands] = useState<HandsNeeded | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const setQuery = (q: string) => {
    setQueryState(q);
    writeQuery(q);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = useMemo(() => filterSkills(skills, { query, difficulty, hands }), [skills, query, difficulty, hands]);
  const filtered = Boolean(query.trim() || difficulty || hands);
  const ready = lessons !== null;

  return (
    <div className="sk-home">
      <PageHeader title="Choose a skill" />
      {offline && <p className="note ap-banner">Backend offline: showing the built-in demo lessons. Practice works locally; scores are estimated on this device.</p>}
      {loading && !ready && <p className="note ap-state">Consulting the ledger...</p>}
      {error && (
        <div className="ap-state">
          <p className="note">The lessons could not be loaded: {error.message}</p>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      {ready && courses.length > 0 && <TodayPanel lessons={courses} />}
      {ready && courses.length === 0 && <p className="note ap-state">No lessons yet. Ask an expert to record one; until then, every skill below is still in the workshop.</p>}
      {ready && (
        <section className="sk-dash" aria-label="Skills">
          <div className="sk-bar">
            <div className="sk-search" role="search">
              <label className="ap-sr" htmlFor="skill-search">
                Search skills
              </label>
              <svg className="sk-search__icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M15.5 15.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                ref={input}
                id="skill-search"
                className="sk-search__input"
                type="search"
                autoComplete="off"
                spellCheck={false}
                placeholder="Search skills, e.g. grip, music, sign"
                aria-keyshortcuts="/"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  if (query) setQuery('');
                  else e.currentTarget.blur();
                }}
              />
              {!query && (
                <kbd className="sk-search__key" aria-hidden="true" title="Press / to search">
                  /
                </kbd>
              )}
            </div>
            <div className="sk-filters">
              <ToggleGroup label="Level" value={difficulty} onChange={setDifficulty} options={DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))} />
              <ToggleGroup
                label="Hands"
                value={hands}
                onChange={setHands}
                options={(['one', 'two'] as HandsNeeded[]).map((h) => ({ value: h, label: HANDS_LABEL[h] }))}
              />
            </div>
          </div>
          <div className="sk-count" hidden={!filtered}>
            <p aria-live="polite">{countLine(shown.length, skills.length, query.trim(), filtered)}</p>
            {query.trim() && shown.length > 0 && (
              <button
                type="button"
                className="sk-link-btn"
                onClick={() => {
                  setQuery('');
                  input.current?.focus();
                }}
              >
                Clear search
              </button>
            )}
          </div>
          {shown.length > 0 ? (
            <ul className="sk-grid">
              {shown.map((s) => (
                <SkillCard key={s.id} skill={s} progress={progressOf(s)} query={query} />
              ))}
            </ul>
          ) : (
            <div className="sk-empty" aria-live="polite">
              <p>
                {query.trim() ? (
                  <>
                    No skill matches &lsquo;{query.trim()}&rsquo;{difficulty || hands ? ' with these filters' : ''}. Try{' '}
                    {SUGGESTIONS.map((w, i) => (
                      <span key={w}>
                        {i > 0 && ' or '}
                        <button type="button" className="sk-empty__try" onClick={() => setQuery(w)}>
                          &lsquo;{w}&rsquo;
                        </button>
                      </span>
                    ))}
                    .
                  </>
                ) : (
                  'No skill matches these filters.'
                )}
              </p>
              <button
                type="button"
                className="sk-empty__try"
                onClick={() => {
                  setQuery('');
                  setDifficulty(null);
                  setHands(null);
                }}
              >
                Show all {skills.length} skills
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
