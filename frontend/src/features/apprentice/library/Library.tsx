import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Lesson, Skill } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card } from '../../../components/ui';
import { useLessonLibrary } from '../hooks/useLessonData';
import { TodayPanel } from './TodayPanel';

const SKILL_LABEL: Record<Skill, string> = { table_tennis: 'Table tennis', piano: 'Piano', general: 'General' };
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** How much of a lesson has the master's real recording behind it. */
export function referenceKind(lesson: Lesson): { label: string; tone: 'ok' | 'neutral' | 'lapis' } {
  const recorded = lesson.steps.filter((s) => s.reference_recording_id).length;
  if (lesson.steps.length > 0 && recorded === lesson.steps.length) return { label: "Expert's recording", tone: 'ok' };
  if (recorded > 0) return { label: `${recorded} of ${lesson.steps.length} recorded`, tone: 'lapis' };
  return { label: 'Mock guide only', tone: 'neutral' };
}

/** One card per lesson title: when a master has recorded the same course twice, the newest wins. */
export function newestPerTitle(lessons: Lesson[]): Lesson[] {
  const key = (l: Lesson) => l.title.trim().toLowerCase();
  const best = new Map<string, Lesson>();
  for (const l of lessons) {
    const seen = best.get(key(l));
    if (!seen || l.created_at > seen.created_at) best.set(key(l), l);
  }
  return lessons.filter((l) => best.get(key(l)) === l);
}

function SkillIcon({ skill }: { skill: Skill }) {
  if (skill === 'piano') {
    return (
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" {...stroke}>
        <rect x="6" y="14" width="52" height="36" rx="3" />
        <path d="M17 14v36M28 14v36M39 14v36M50 14v36" />
        <path d="M14 14v20h6V14M25 14v20h6V14M47 14v20h6V14" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" {...stroke}>
      <circle cx="26" cy="26" r="16" />
      <path d="M37 37l16 16M50 50l4 4" />
      <circle cx="50" cy="14" r="3.5" fill="currentColor" />
    </svg>
  );
}

/** Apprentice landing: every lesson with its skill, master, step count and whether a real recording backs it. */
export function Library() {
  const { data: lessons, loading, error, offline, reload } = useLessonLibrary();
  const unique = useMemo(() => (lessons ? newestPerTitle(lessons) : []), [lessons]);
  return (
    <>
      <PageHeader title="Choose a lesson" />
      {offline && <p className="note ap-banner">Backend offline: showing the built-in demo lessons. Practice works locally; scores are estimated on this device.</p>}
      {loading && <p className="note ap-state">Consulting the ledger...</p>}
      {error && (
        <div className="ap-state">
          <p className="note">The lessons could not be loaded: {error.message}</p>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      {lessons && lessons.length === 0 && <p className="note ap-state">No lessons yet. Ask an expert to record one, then come back.</p>}
      {lessons && lessons.length > 0 && <TodayPanel lessons={unique} />}
      {lessons && lessons.length > 0 && (
        <ul className="ap-library">
          {unique.map((l) => {
            const ref = referenceKind(l);
            return (
              <li key={l.id}>
                <Card as="article" interactive className="ap-lib-card">
                  <Link to={`/apprentice/lessons/${l.id}`} className="ap-lib-card__link" aria-label={`Open ${l.title}`} />
                  <div className="ap-lib-card__icon">
                    <SkillIcon skill={l.skill} />
                  </div>
                  <div className="ap-lib-card__body">
                    <h2>{l.title}</h2>
                    <p className="note">{l.summary}</p>
                    <ul className="ap-meta" aria-label="Lesson details">
                      <li>{SKILL_LABEL[l.skill]}</li>
                      <li>Expert: {l.master_name}</li>
                      <li>{l.steps.length} {l.steps.length === 1 ? "lesson" : "lessons"}</li>
                      {l.test && <li>Final test</li>}
                    </ul>
                    <p className="ap-lib-card__ref">{ref.label}</p>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
