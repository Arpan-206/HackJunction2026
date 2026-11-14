import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import type { Lesson } from '../../../api';
import { Button, Card } from '../../../components/ui';
import { formatWhen } from '../../master/lib';
import { usePracticePlan } from '../hooks/usePracticePlan';
import { useAssistant } from '../../shared/assistant';
import { FINGER_LABEL } from '../training/coach/tips';

/** Who wrote the plan, in plain words. Provider names stay in the developer panel. */
const sourceLine = (provider: string): string =>
  provider.startsWith('fake') ? 'Worked out from your weakest fingers while the assistant was unavailable.' : 'Written by the assistant.';

/**
 * "Plan for tomorrow": once a learner has finished attempts in this lesson, the assistant turns the scores kept on
 * this device into a short summary and one to four drills. Hidden while the assistant is off.
 */
export function PlanCard({ lesson }: { lesson: Lesson }) {
  const p = usePracticePlan(lesson);
  const [assistant] = useAssistant();
  const ref = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#plan') ref.current?.scrollIntoView({ block: 'start' });
  }, [hash]);

  if (!assistant || (p.attempts === 0 && !p.stored)) return null;
  const titleOf = (id: string) => lesson.steps.find((s) => s.id === id)?.title ?? 'This lesson';

  return (
    <div ref={ref} id="plan">
      <Card title="Plan for tomorrow" className="ap-plan">
        {p.stored ? (
          <>
            <p className="ap-plan__summary">{p.stored.plan.summary}</p>
            <ol className="ap-plan__drills">
              {p.stored.plan.drills.map((d, i) => (
                <li key={`${d.step_id}-${i}`} className="ap-plan__drill">
                  <h3>{titleOf(d.step_id)}</h3>
                  {d.focus_finger && <span className="ap-plan__focus">Watch your {FINGER_LABEL[d.focus_finger].toLowerCase()}.</span>}
                  <p>{d.exercise}</p>
                </li>
              ))}
            </ol>
            <p className="ap-plan__source">
              {sourceLine(p.stored.plan.provider)} Asked for {formatWhen(p.stored.at)}.
            </p>
          </>
        ) : (
          <p className="note">
            You have {p.attempts} {p.attempts === 1 ? 'attempt' : 'attempts'} on this device. The assistant can turn them into a short plan.
          </p>
        )}
        {p.error && (
          <p className="mst-alert mst-alert--error" role="alert">
            {p.error}
          </p>
        )}
        {p.attempts > 0 && (
          <div>
            <Button variant={p.stored ? 'secondary' : 'primary'} onClick={() => void p.request()} disabled={p.busy}>
              {p.busy ? 'The assistant is thinking...' : p.stored ? 'Make a fresh plan' : 'Plan for tomorrow'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
