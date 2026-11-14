import type { ReactNode } from 'react';
import { Button } from '../../../components/ui';
import { SCREEN_LABEL, SCREENS, type Screen } from './scratchDraft';

interface NavAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why the action is disabled, said beside it in plain words. */
  reason?: string;
}

interface FlowNavProps {
  back?: NavAction;
  next?: NavAction;
  /** A quiet secondary action between Back and Next (for example "Add another move"). */
  extra?: ReactNode;
  /** One short line about the current choice, beside the actions. */
  summary?: string;
}

/** The bar under every screen of the flow: Back on the left, the one primary action on the right. */
export function FlowNav({ back, next, extra, summary }: FlowNavProps) {
  return (
    <div className="scr-nav">
      <div className="scr-nav__start">
        {back && (
          <Button variant="ghost" onClick={back.onClick} disabled={back.disabled}>
            <span aria-hidden="true" className="scr-nav__arrow" />
            {back.label}
          </Button>
        )}
        {summary && <span className="scr-nav__summary">{summary}</span>}
      </div>
      <div className="scr-nav__end">
        {extra}
        {next?.disabled && next.reason && <span className="reason">{next.reason}</span>}
        {next && (
          <Button large onClick={next.onClick} disabled={next.disabled}>
            {next.label}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Where the expert is in the flow, as one slim line of four words. Finished screens are links back; the current one is
 * underlined; later ones are plain text until they are reachable.
 */
export function FlowProgress({ current, reachable, onGo }: { current: Screen; reachable: (s: Screen) => boolean; onGo: (s: Screen) => void }) {
  const at = SCREENS.indexOf(current);
  return (
    <ol className="scr-progress" aria-label="Progress">
      {SCREENS.map((s, i) => {
        const state = i === at ? 'current' : i < at ? 'done' : 'todo';
        const canGo = state !== 'current' && reachable(s);
        return (
          <li key={s} className={`scr-progress__item scr-progress__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            {canGo ? (
              <button type="button" className="scr-progress__link" onClick={() => onGo(s)}>
                {SCREEN_LABEL[s]}
              </button>
            ) : (
              <span>{SCREEN_LABEL[s]}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
