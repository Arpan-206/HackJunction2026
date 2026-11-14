import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Lesson } from '../../../api';
import { Card } from '../../../components/ui';
import { useAllAttempts, useAllTests } from '../../shared/practiceLog';
import { seedDemoHistoryIfEmpty } from '../pipeline/demoHistory';
import { isDemo } from '../pipeline/flags';
import { dayKey, daysPractised, deriveStep, isDue, overdueDays, weekMarks } from '../pipeline/progress';
import { DEFAULT_CONFIG, DEMO_CONFIG } from '../pipeline/stages';
import { currentStreak, dayButtonLabel, dayDetail, longDay, streakLabel, type DayDetail } from '../pipeline/streak';
import { skillName } from '../skills/catalogue';
import { quoteCredit, quoteOfDay, quoteSource } from './quotes';

interface DueItem {
  lesson: Lesson;
  index: number;
  stepTitle: string;
  late: number;
}

const POP_ID = 'ap-daypop';

/** The detail under the week row for one day: lessons practised, time, best score and anything mastered. */
function DayPopover({ detail, isToday }: { detail: DayDetail; isToday: boolean }) {
  const empty = detail.lessons.length === 0 && detail.tests.length === 0;
  const mastered = detail.lessons.filter((l) => l.mastered).length;
  return (
    <div className="ap-daypop" id={POP_ID} role="region" aria-labelledby={`${POP_ID}-title`} aria-live="polite">
      <p className="ap-daypop__title" id={`${POP_ID}-title`}>
        {longDay(detail.day)}
        {isToday ? ', today' : ''}
      </p>
      {empty ? (
        <p className="ap-daypop__empty">{isToday ? 'Nothing practised yet today.' : 'A rest day: no practice.'}</p>
      ) : (
        <>
          <p className="ap-daypop__sum">
            About {detail.minutes} {detail.minutes === 1 ? 'minute' : 'minutes'}
            {detail.best !== null ? `, best score ${detail.best}` : ''}
            {mastered > 0 && (
              <>
                , <span className="ap-daypop__mastered">{mastered} mastered</span>
              </>
            )}
          </p>
          <ul className="ap-daypop__list">
            {detail.lessons.map((l) => (
              <li key={`${l.lessonId}:${l.stepId}`}>
                <span className="ap-daypop__lesson">
                  <strong>{l.skill}</strong>: {l.lesson}
                </span>
                <span className="ap-daypop__meta">
                  {l.mastered ? <span className="ap-daypop__mastered">mastered</span> : l.review ? 'review' : `${l.reps} ${l.reps === 1 ? 'rep' : 'reps'}`}
                  , best {l.best}
                </span>
              </li>
            ))}
            {detail.tests.map((t, i) => (
              <li key={`test:${i}`}>
                <span className="ap-daypop__lesson">
                  <strong>Test</strong>: {t.lesson}
                </span>
                <span className="ap-daypop__meta">
                  {t.passed ? 'passed' : 'not passed'}, {t.overall}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The top of the learner dashboard: a Renaissance quote for the day (or the reviews due today), and the week with the current
 * streak. Each past day opens a short account of what was practised. On a device with no practice yet, believable demo history
 * is seeded (see pipeline/demoHistory.ts), never over real practice.
 */
export function TodayPanel({ lessons }: { lessons: Lesson[] }) {
  const attempts = useAllAttempts();
  const tests = useAllTests();
  const demo = isDemo();
  const today = dayKey(new Date());
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState(today);
  const weekRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    seedDemoHistoryIfEmpty(lessons);
  }, [lessons]);

  const cfg = demo ? DEMO_CONFIG : DEFAULT_CONFIG;
  const due = useMemo(() => {
    const out: DueItem[] = [];
    for (const l of lessons) {
      const log = attempts[l.id] ?? [];
      l.steps.forEach((s, index) => {
        const m = deriveStep(s.id, log, cfg);
        if (isDue(m, today)) out.push({ lesson: l, index, stepTitle: s.title, late: overdueDays(m, today) });
      });
    }
    return out.sort((a, b) => b.late - a.late);
  }, [lessons, attempts, cfg, today]);

  const practised = useMemo(() => daysPractised(Object.values(attempts).flat(), Object.values(tests).flat()), [attempts, tests]);
  const marks = useMemo(() => weekMarks(practised, today), [practised, today]);
  const streak = useMemo(() => currentStreak(practised, today), [practised, today]);
  const inStreak = new Set(streak.days);
  const details = useMemo(() => {
    const out = new Map<string, DayDetail>();
    for (const m of marks) if (!m.future) out.set(m.day, dayDetail(m.day, lessons, attempts, tests, (id) => skillName(id), cfg));
    return out;
  }, [marks, lessons, attempts, tests, cfg]);
  const open = openDay ? details.get(openDay) : undefined;
  const pickable = marks.filter((m) => !m.future).map((m) => m.day);
  const quote = quoteOfDay(today);

  // A click or tap outside the week closes the day's detail.
  useEffect(() => {
    if (!openDay) return;
    const onDown = (e: PointerEvent) => {
      if (weekRef.current && !weekRef.current.contains(e.target as Node)) setOpenDay(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openDay]);

  const moveTo = (day: string) => {
    setFocusDay(day);
    buttons.current.get(day)?.focus();
    // With the detail open it follows the focused day.
    if (openDay) setOpenDay(day);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const i = pickable.indexOf(day);
    let next: string | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = pickable[Math.min(pickable.length - 1, i + 1)];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = pickable[Math.max(0, i - 1)];
    else if (e.key === 'Home') next = pickable[0];
    else if (e.key === 'End') next = pickable[pickable.length - 1];
    else if (e.key === 'Escape' && openDay) {
      e.preventDefault();
      setOpenDay(null);
      return;
    }
    if (next) {
      e.preventDefault();
      moveTo(next);
    }
  };

  const tabDay = pickable.includes(focusDay) ? focusDay : today;

  return (
    <Card title="Today" className="ap-today" aria-label="Today">
      <div className="ap-today__grid">
        <div className="ap-today__main">
          {due.length > 0 ? (
            <div className="ap-today__duebox">
              <p className="ap-today__lede">{due.length === 1 ? 'One review is due today:' : `${due.length} reviews are due today:`}</p>
              <ul className="ap-today__due">
                {due.map((d) => (
                  <li key={`${d.lesson.id}:${d.index}`}>
                    <Link to={`/apprentice/lessons/${d.lesson.id}/steps/${d.index}`}>
                      <strong>{d.stepTitle}</strong>
                      <span>
                        {skillName(d.lesson.skill)}
                        {d.late > 0 ? `, ${d.late} ${d.late === 1 ? 'day' : 'days'} waiting` : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <figure className="ap-quote">
              <blockquote className="ap-quote__text">
                <p>&ldquo;{quote.text}&rdquo; </p>
              </blockquote>
              <figcaption className="ap-quote__credit" title={quoteSource(quote)}>
                {quoteCredit(quote)}
              </figcaption>
            </figure>
          )}
        </div>
        <div className="ap-today__week" ref={weekRef}>
          <p className={`ap-streak${streak.length > 0 ? ' is-on' : ''}`}>{streakLabel(streak)}</p>
          <ol className="ap-weekmarks" aria-label="This week, Monday to Sunday">
            {marks.map((m, i) => {
              const linked = inStreak.has(m.day) && i > 0 && inStreak.has(marks[i - 1].day);
              const cls = ['ap-weekmarks__day', m.practised ? 'is-on' : '', m.today ? 'is-today' : '', m.future ? 'is-future' : '', inStreak.has(m.day) ? 'is-streak' : '']
                .filter(Boolean)
                .join(' ');
              const inner = (
                <>
                  <span className="ap-weekmarks__dot" aria-hidden="true" />
                  <span className="ap-weekmarks__letter" aria-hidden="true">
                    {m.label}
                  </span>
                </>
              );
              const d = details.get(m.day);
              return (
                <li key={m.day} className={linked ? 'is-linked' : undefined}>
                  {m.future ? (
                    <span className={cls}>
                      {inner}
                      <span className="ap-sr">{longDay(m.day)}, still to come</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={cls}
                      ref={(el) => {
                        if (el) buttons.current.set(m.day, el);
                        else buttons.current.delete(m.day);
                      }}
                      tabIndex={m.day === tabDay ? 0 : -1}
                      aria-label={dayButtonLabel(m.day, (d?.lessons.length ?? 0) + (d?.tests.length ?? 0), m.today)}
                      aria-expanded={openDay === m.day}
                      aria-controls={openDay === m.day ? POP_ID : undefined}
                      aria-current={m.today ? 'date' : undefined}
                      onFocus={() => setFocusDay(m.day)}
                      onClick={() => {
                        setFocusDay(m.day);
                        setOpenDay((o) => (o === m.day ? null : m.day));
                      }}
                      onKeyDown={(e) => onKey(e, m.day)}
                    >
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {open && <DayPopover detail={open} isToday={open.day === today} />}
        </div>
      </div>
    </Card>
  );
}
