import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Lesson, Step } from '../../../api';
import { ButtonLink } from '../../../components/ui';
import { useAllAttempts, useAllTests } from '../../shared/practiceLog';
import { finaleBlurb, finaleTitle, lessonTitle } from '../course/LessonCourse';
import { useReducedMotion } from '../../shared/settings';
import { isDemo } from '../pipeline/flags';
import { playRecord, tutorialsSeen } from '../pipeline/journey';
import { DEFAULT_CONFIG, DEMO_CONFIG } from '../pipeline/stages';
import type { SkillProgress, SkillView } from './catalogue';
import { expertName, skillJourney, type PathCourse, type PathFinale, type PathLesson, type PathPart } from './journeyMap';

/** One stop on the line: a lesson of a course, or the game (or Play round) that closes the course. */
export type Stop =
  | { kind: 'lesson'; key: string; course: Lesson; path: PathCourse; step: Step; lesson: PathLesson }
  | { kind: 'finale'; key: string; course: Lesson; path: PathCourse; finale: PathFinale };

/** A lesson's title without its "Lesson 2:" prefix: the number already sits in the node. */
function shortTitle(step: Step): string {
  return step.title.replace(/^lesson\s*\d+\s*:\s*/i, '');
}

/** Every course's lessons in order, each course closed by its game, as one flat line of stops. */
export function stopsOf(courses: Lesson[], paths: PathCourse[]): Stop[] {
  return courses.flatMap((course, ci): Stop[] => {
    const path = paths[ci];
    const lessons: Stop[] = course.steps.map((step, i) => ({ kind: 'lesson', key: `${course.id}:${i}`, course, path, step, lesson: path.lessons[i] }));
    return [...lessons, { kind: 'finale', key: `${course.id}:finale`, course, path, finale: path.finale }];
  });
}

/** The short line under a node: where the learner stands with that stop. */
export function nodeState(stop: Stop): string {
  if (stop.kind === 'finale') return stop.finale.best !== null ? `Best ${stop.finale.best}` : 'Not played';
  const l = stop.lesson;
  if (l.here) return 'You are here';
  if (l.mastered) return l.due ? 'Review due' : 'Mastered';
  return l.attempts > 0 ? `Best ${l.best}` : 'Not started';
}

/** The longer line in the panel under the line. */
export function stopDetail(stop: Stop): string {
  if (stop.kind === 'finale') {
    const unit = stop.course.test ? 'game' : 'round';
    if (stop.finale.best !== null) return `Best ${stop.finale.best} in ${stop.finale.played} ${stop.finale.played === 1 ? unit : `${unit}s`}.`;
    return stop.path.mastered < stop.path.lessons.length ? 'Open now, and best played after the lessons.' : 'Every lesson mastered: time to play.';
  }
  const l = stop.lesson;
  if (l.mastered) return l.due ? `Mastered, best ${l.best}. Review due today.` : `Mastered, best ${l.best}. Practise it again any time.`;
  if (l.attempts === 0) return 'Not started yet.';
  return `Best ${l.best} in ${l.attempts} ${l.attempts === 1 ? 'attempt' : 'attempts'}.`;
}

/** What the panel's one button says for a stop. */
export function actionLabel(stop: Stop, next: SkillProgress['next']): string {
  if (stop.kind === 'finale') return stop.course.test ? 'Test your skills' : 'Play a round';
  const l = stop.lesson;
  const n = l.index + 1;
  // The current lesson keeps the skill-wide wording: once a skill is under way its next lesson reads "Continue".
  if (l.here && next) return next.kind === 'start' ? `Start lesson ${n}` : next.kind === 'continue' ? `Continue lesson ${n}` : `Review lesson ${n}`;
  if (l.mastered && l.due) return `Review lesson ${n}`;
  if (l.mastered) return `Practise lesson ${n} again`;
  return l.attempts > 0 ? `Continue lesson ${n}` : `Start lesson ${n}`;
}

function nodeTone(stop: Stop): string {
  if (stop.kind === 'finale') return stop.finale.played > 0 ? ' is-started' : '';
  const l = stop.lesson;
  // The current lesson keeps its walnut "you are here" mark even when mastered (a review is due); CSS adds a gold rim.
  return `${l.here ? ' is-here' : ''}${l.mastered ? ' is-mastered' : ''}${!l.here && !l.mastered && l.attempts > 0 ? ' is-started' : ''}`;
}

/** A stop is behind the learner once its lesson is mastered or its game played: the line after it is inked in. */
export function isBehind(stop: Stop): boolean {
  return stop.kind === 'finale' ? stop.finale.played > 0 : stop.lesson.mastered;
}

/** The ink mark beside a part: a malachite tick when done (gold for Ghost off, which is mastery), a dot now, a ring ahead. */
function PartMark({ state, mastery }: { state: PathPart['state']; mastery: boolean }) {
  return (
    <svg className={`sk-part__mark${mastery ? ' is-gold' : ''}`} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      {state === 'done' ? (
        <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : state === 'now' ? (
        <circle cx="10" cy="10" r="5.5" fill="currentColor" />
      ) : (
        <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      )}
    </svg>
  );
}

const PART_STATE_TEXT: Record<PathPart['state'], string> = { done: 'done', now: 'up next', next: 'ahead' };

/** The panel under the line: the chosen stop's title, where the learner stands, the one action, and the lesson's parts. */
function StopPanel({ stop, next, id, tabId, here: hereStop, onBack }: { stop: Stop; next: SkillProgress['next']; id: string; tabId: string; here: Stop | undefined; onBack: () => void }) {
  const title = stop.kind === 'finale' ? finaleTitle(stop.course) : lessonTitle(stop.step, stop.lesson.index);
  const to = stop.kind === 'finale' ? stop.finale.to : stop.lesson.to;
  const here = stop.kind === 'lesson' && stop.lesson.here;
  return (
    <div id={id} role="tabpanel" aria-labelledby={tabId} className={`sk-stop${here ? ' is-here' : ''}`}>
      <div className="sk-stop__head">
        <h4 className="sk-stop__title">{title}</h4>
        <p className="sk-stop__state">{stopDetail(stop)}</p>
      </div>
      {hereStop && hereStop.kind === 'lesson' && hereStop.key !== stop.key && (
        <p className="sk-stop__back">
          <button type="button" onClick={onBack}>
            Back to lesson {hereStop.lesson.index + 1}, where you are
          </button>
        </p>
      )}
      <div className="sk-actions">
        <ButtonLink to={to} large>
          {actionLabel(stop, next)}
        </ButtonLink>
      </div>
      {stop.kind === 'finale' && <p className="sk-stop__blurb">{finaleBlurb(stop.course)}</p>}
      {stop.kind === 'lesson' && (
        <ol className="sk-parts" aria-label={`Parts of ${title}`}>
          {stop.lesson.parts.map((p) => (
            <li key={p.key}>
              <Link to={p.to} className={`sk-part is-${p.state}`}>
                <PartMark state={p.state} mastery={p.key === 'blind' && p.state === 'done'} />
                <span>{p.label}</span>
                <span className="ap-sr">, {PART_STATE_TEXT[p.state]}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The skill's path as inked lines of nodes, one line per course under its title: every lesson in order, the course closed
 * by its game as a lozenge. The learner's current lesson starts chosen; choosing any other node (click, or the arrow keys,
 * which run on across the courses) swaps the one panel under the lines to it, so an old lesson is as easy to practise
 * again as the next one.
 */
export function SkillTrail({ skill, progress }: { skill: SkillView; progress: SkillProgress }) {
  const attempts = useAllAttempts();
  const tests = useAllTests();
  const cfg = isDemo() ? DEMO_CONFIG : DEFAULT_CONFIG;
  const paths = skillJourney({ courses: skill.courses, progress, attempts, tests, seen: tutorialsSeen, played: playRecord, cfg });
  const stops = stopsOf(skill.courses, paths);
  const hereKey = stops.find((s) => s.kind === 'lesson' && s.lesson.here)?.key ?? stops[0]?.key;
  const [picked, setPicked] = useState<string | null>(null);
  const selectedKey = picked && stops.some((s) => s.key === picked) ? picked : hereKey;
  const selected = stops.find((s) => s.key === selectedKey) ?? stops[0];
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  /** False until the first centring, which jumps; later ones (a new choice) glide. */
  const moved = useRef(false);
  const [reduceMotion] = useReducedMotion();
  const stopIds = useMemo(() => stops.map((s) => s.key).join('|'), [stops]);

  // Scroll the chosen node into view (centred) only when it is out of view on a line wider than its column; never scroll the page itself.
  useEffect(() => {
    const btn = selectedKey ? nodes.current.get(selectedKey) : undefined;
    const ol = btn?.closest('ol');
    if (!ol || !btn || ol.scrollWidth <= ol.clientWidth) return;
    const li = btn.parentElement as HTMLElement;
    const inView = li.offsetLeft >= ol.scrollLeft && li.offsetLeft + li.offsetWidth <= ol.scrollLeft + ol.clientWidth;
    if (inView) {
      moved.current = true;
      return;
    }
    const smooth = moved.current && !reduceMotion;
    ol.scrollTo({ left: li.offsetLeft - (ol.clientWidth - li.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
    moved.current = true;
  }, [selectedKey, stopIds, reduceMotion]);

  if (!selected) return null;

  const choose = (key: string, focus: boolean) => {
    setPicked(key);
    if (focus) nodes.current.get(key)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const at = stops.findIndex((s) => s.key === selectedKey);
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? stops.length - 1 : null;
    if (to === null || to < 0 || to >= stops.length) return;
    e.preventDefault();
    choose(stops[to].key, true);
  };
  const tabIdOf = (key: string) => `sk-node-${skill.id}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const hereStop = stops.find((s) => s.key === hereKey);

  const panelId = `sk-stop-${skill.id}`;
  return (
    <section className="sk-trail" aria-labelledby="sk-trail-h">
      <div className="sk-trail__head">
        <h2 id="sk-trail-h">Your path</h2>
        <p className="sk-trail__sum">
          <span className="ap-num">{progress.mastered}</span> of <span className="ap-num">{progress.total}</span> {progress.total === 1 ? 'lesson' : 'lessons'} mastered
        </p>
      </div>
      {skill.courses.map((course, ci) => {
        const row = stops.filter((st) => st.course.id === course.id);
        // Each course's row is reachable with Tab: its chosen node, or its first one when the choice is in another row.
        const entry = row.some((st) => st.key === selectedKey) ? selectedKey : row[0]?.key;
        return (
          <div key={course.id} className="sk-trail__row sk-course">
            <div className="sk-trail__course">
              <h3 id={`sk-course-${course.id}`}>{course.title}</h3>
              <p>
                Taught by {expertName(course.master_name)}.{' '}
                <Link to={paths[ci].to} className="sk-link">
                  Open the course
                </Link>
              </p>
            </div>
            <ol className="sk-line" role="tablist" aria-orientation="horizontal" onKeyDown={onKey} aria-labelledby={`sk-course-${course.id}`}>
              {row.map((stop, i) => {
                const on = stop.key === selectedKey;
                const label = stop.kind === 'finale' ? finaleTitle(stop.course) : shortTitle(stop.step);
                return (
                  <li key={stop.key} role="presentation" className={`sk-line__stop${nodeTone(stop)}${stop.kind === 'finale' ? ' is-finale' : ''}${isBehind(stop) ? ' is-behind' : ''}${i === row.length - 1 ? ' is-last' : ''}`}>
                    <button
                      ref={(el) => {
                        if (el) nodes.current.set(stop.key, el);
                        else nodes.current.delete(stop.key);
                      }}
                      type="button"
                      role="tab"
                      id={tabIdOf(stop.key)}
                      className={`sk-line__node${on ? ' is-selected' : ''}`}
                      aria-selected={on}
                      aria-controls={panelId}
                      aria-current={stop.kind === 'lesson' && stop.lesson.here ? 'step' : undefined}
                      tabIndex={stop.key === entry ? 0 : -1}
                      onClick={() => choose(stop.key, false)}
                    >
                      <span className="sk-line__mark" aria-hidden="true">
                        {stop.kind === 'lesson' ? (
                          <span className="sk-line__num">{stop.lesson.index + 1}</span>
                        ) : (
                          <svg className="sk-line__play" viewBox="0 0 12 12" width="12" height="12">
                            <path d="M3.5 2.2v7.6L9.8 6z" fill="currentColor" />
                          </svg>
                        )}
                      </span>
                      <span className="sk-line__label">
                        {stop.kind === 'lesson' && <span className="ap-sr">Lesson {stop.lesson.index + 1}: </span>}
                        {label}
                      </span>
                      <span className="sk-line__state">{nodeState(stop)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
      <StopPanel stop={selected} next={progress.next} id={panelId} tabId={tabIdOf(selected.key)} here={hereStop} onBack={() => hereKey && choose(hereKey, true)} />
    </section>
  );
}
