import { useEffect, useState } from 'react';
import { FINGER_LABEL } from '../../features/apprentice/training/coach/tips';
import { loadHints, type RecordedHint } from '../data';

const ERROR_WORDS: Record<string, string> = {
  too_curled: 'curled too much',
  too_flat: 'too flat',
  too_spread: 'spread too wide',
  too_closed: 'too close to its neighbour',
};
const LANGUAGE: Record<string, string> = { en: 'English', de: 'German', fi: 'Finnish' };

export default function CoachStop() {
  const [hints, setHints] = useState<RecordedHint[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadHints().then((h) => alive && setHints(h));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="tour-stop">
      <p className="tour-lead">
        After a rep, the AI Assistant reads the scorer's result and writes one short line: the single finger to fix, as a physical cue, never in degrees.
      </p>

      <h3 className="tour-h3">Recorded hints</h3>
      <p className="tour-small">Real lines the AI Assistant wrote during our test, with the attempt each one was given. Nothing here is generated now.</p>
      {hints ? (
        <ul className="tour-hints">
          {hints.map((h, i) => (
            <li key={i} className="tour-hint">
              <span className="tour-hint__label">Recorded hint</span>
              <q className="tour-hint__line" lang={h.lang}>
                {h.line}
              </q>
              <span className="tour-hint__input">
                Given: {h.step} ({h.task}). {FINGER_LABEL[h.finger]} {ERROR_WORDS[h.error] ?? h.error}, score {h.score}. Language: {LANGUAGE[h.lang] ?? h.lang}.
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tour-loading">Loading the recorded hints...</p>
      )}

      <h3 className="tour-h3">How often it is right</h3>
      <p>
        A line counts as right only when it names the right finger, gives the right direction and keeps the style rules, all at once.
      </p>
      <table className="tour-table">
        <caption>Share of lines right on all three counts</caption>
        <thead>
          <tr>
            <th scope="col">Test set</th>
            <th scope="col">Before tuning</th>
            <th scope="col">Tuned</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">All 1,150 held-out test examples</th>
            <td>55.5%</td>
            <td>89.0%</td>
          </tr>
          <tr>
            <th scope="row">The 333 real glove capture frames in that set</th>
            <td>43.5%</td>
            <td>62.2%</td>
          </tr>
        </tbody>
      </table>
      <p>
        It matches its 31B teacher on our held-out test (89.0% vs 85.7%). The training labels were filtered for correctness: a teacher line was kept only when it named
        the right finger and the right fix. On the real capture frames the teacher is still ahead (66.7%).
      </p>
      <p className="tour-small">
        What it was tested on: 9 units never seen in training (the letters E, K, L, T and Z, the swan shadow puppet, two replay lessons and a demo set of hand shapes).
        817 attempts are synthetic, with one finger pushed off; 333 are real frames from a glove capture. The hints shown above are from the synthetic attempts. The AI
        Assistant is a small open model we tuned ourselves.
      </p>
    </section>
  );
}
