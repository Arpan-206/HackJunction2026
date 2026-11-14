import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Lesson } from '../../../api';
import { Button, Card } from '../../../components/ui';
import { replaceLog, useAllAttempts, useAllTests } from '../../shared/practiceLog';
import { buildDemoHistory } from '../pipeline/demoHistory';
import { isDemo, isDev } from '../pipeline/flags';
import { dayKey, daysPractised, deriveStep, isDue, overdueDays, weekMarks, weekSummary } from '../pipeline/progress';
import { reviewLine } from '../pipeline/coachLines';
import { DEFAULT_CONFIG, DEMO_CONFIG } from '../pipeline/stages';

const GOAL_KEY = 'apprentice.weeklyGoal.v1';
const SEEDED_KEY = 'apprentice.demoSeeded.v1';
const GOALS = [3, 5] as const;

function readGoal(): number {
  try {
    const v = Number(localStorage.getItem(GOAL_KEY));
    return GOALS.includes(v as 3 | 5) ? v : 3;
  } catch {
    return 3;
  }
}

/** True once demo history has been loaded on this device, so a reload never overwrites real practice. */
function alreadySeeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(SEEDED_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

interface DueItem {
  lesson: Lesson;
  index: number;
  stepTitle: string;
  late: number;
}

/**
 * The top of the learner dashboard: what is due for review today, and a forgiving practice mark for the week (days practised against a
 * goal the learner picks, never a chain that breaks). With ?demo=1 believable history is seeded once; ?dev=1 adds a button.
 */
export function TodayPanel({ lessons }: { lessons: Lesson[] }) {
  const attempts = useAllAttempts();
  const tests = useAllTests();
  const [goal, setGoal] = useState(readGoal);
  const demo = isDemo();
  const dev = isDev();
  const today = dayKey(new Date());

  // Seed once, the first time demo mode sees a library with no history at all.
  const empty = Object.values(attempts).every((l) => l.length === 0);
  useEffect(() => {
    if (demo && empty && lessons.length > 0 && !alreadySeeded()) {
      markSeeded();
      replaceLog(buildDemoHistory(lessons));
    }
  }, [demo, empty, lessons]);

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

  const marks = useMemo(() => {
    const logs = Object.values(attempts).flat();
    const all = Object.values(tests).flat();
    return weekMarks(daysPractised(logs, all), today);
  }, [attempts, tests, today]);
  const week = weekSummary(marks, goal);

  const pickGoal = (g: number) => {
    setGoal(g);
    try {
      localStorage.setItem(GOAL_KEY, String(g));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <Card title="Today" className="ap-today" aria-label="Today">
      <div className="ap-today__grid">
        <div>
          <p className="ap-today__lede">{reviewLine(due.length)}</p>
          {due.length > 0 && (
            <ul className="ap-today__due">
              {due.map((d) => (
                <li key={`${d.lesson.id}:${d.index}`}>
                  <Link to={`/apprentice/lessons/${d.lesson.id}/steps/${d.index}`}>
                    <strong>{d.stepTitle}</strong>
                    <span>
                      {d.lesson.title}
                      {d.late > 0 ? `, ${d.late} ${d.late === 1 ? 'day' : 'days'} waiting` : ', due today'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {due.length === 0 && <p className="note">Pick a skill below. A lesson you master comes back for review tomorrow.</p>}
        </div>
        <div className="ap-today__week">
          <ol className="ap-weekmarks" aria-label="Days practised this week">
            {marks.map((m) => (
              <li key={m.day} className={`${m.practised ? 'is-on' : ''} ${m.today ? 'is-today' : ''} ${m.future ? 'is-future' : ''}`}>
                <span className="ap-weekmarks__dot" aria-hidden="true" />
                <span className="ap-weekmarks__day">{m.label}</span>
                <span className="ap-sr">{m.practised ? `${m.day}: practised` : `${m.day}: no practice`}</span>
              </li>
            ))}
          </ol>
          <p className="ap-today__weekline">{week.line}</p>
          <div className="ap-today__goal" role="group" aria-label="Weekly goal">
            <span>Goal</span>
            {GOALS.map((g) => (
              <button key={g} type="button" className={g === goal ? 'is-on' : ''} aria-pressed={g === goal} onClick={() => pickGoal(g)}>
                {g} days
              </button>
            ))}
          </div>
        </div>
      </div>
      {dev && (
        <div className="ap-today__dev">
          <Button
            variant="secondary"
            onClick={() => {
              markSeeded();
              replaceLog(buildDemoHistory(lessons));
            }}
          >
            Load demo history
          </Button>
        </div>
      )}
    </Card>
  );
}
