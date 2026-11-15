import { useEffect, useState } from 'react';
import { FINGER_LABEL } from '../../features/apprentice/training/coach/tips';
import { loadHints, loadReviews, type RecordedHint, type RecordedReview } from '../data';

const ERROR_WORDS: Record<string, string> = {
  too_curled: 'curled too much',
  too_flat: 'too flat',
  too_spread: 'spread too wide',
  too_closed: 'too close to its neighbour',
};
const LANGUAGE: Record<string, string> = { en: 'English', de: 'German', fi: 'Finnish' };
const SOURCE: Record<string, string> = { capture: 'a real capture frame', synthetic: 'a synthetic test row' };

export default function CoachStop() {
  const [hints, setHints] = useState<RecordedHint[] | null>(null);
  const [reviews, setReviews] = useState<RecordedReview[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadHints().then((h) => alive && setHints(h));
    void loadReviews().then((r) => alive && setReviews(r));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="tour-stop">
      <p className="tour-lead">The AI Assistant has two jobs: feedback after a repetition, and short hints during practice. Each names the one finger to fix, as a physical cue.</p>

      <table className="tour-table">
        <caption>Right on finger, direction and style at once, on 1,150 held-out examples</caption>
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">Before tuning</th>
            <th scope="col">Tuned</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Feedback after a repetition</th>
            <td>54.8%</td>
            <td>
              <strong>94.8%</strong>
            </td>
          </tr>
          <tr>
            <th scope="row">Hints during practice</th>
            <td>55.5%</td>
            <td>
              <strong>89.0%</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Both are the same small open model, tuned the same way, once for each job, and tested on the same 1,150 held-out examples. Each job has its own checks, so
        the two numbers are two jobs, not one model getting better.
      </p>
      <p>
        On the 333 real glove capture frames in that test: feedback 82.6% (34.2% before tuning), hints 62.2% (43.5% before). For both jobs, the tuned model matches
        its 31B teacher on our held-out test; the training labels were filtered for correctness. On real capture frames the teacher is still ahead for hints (66.7%).
      </p>
      <p className="tour-small">
        Labels written in 35 s and 48 s; training in under 4 minutes on one GPU; a hint answers in 0.108 s (median).
      </p>

      <h3 className="tour-h3">Recorded feedback</h3>
      <p className="tour-small">Real lines the AI Assistant wrote after a repetition during our test, with the attempt each one was given. Nothing here is generated now.</p>
      {reviews ? (
        <ul className="tour-hints">
          {reviews.map((r, i) => (
            <li key={i} className="tour-hint">
              <span className="tour-hint__label">Recorded feedback, from {SOURCE[r.source] ?? r.source}</span>
              <q className="tour-hint__line">{r.line}</q>
              <span className="tour-hint__input">
                Given: {r.step}. {FINGER_LABEL[r.finger]} {ERROR_WORDS[r.error] ?? r.error}, score {r.score}.
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tour-loading">Loading the recorded feedback...</p>
      )}

      <h3 className="tour-h3">Recorded hints</h3>
      <p className="tour-small">Real hints from the same test. All six come from synthetic test rows.</p>
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

      <p className="tour-small">
        What it was tested on: 9 units never seen in training (the letters E, K, L, T and Z, the swan shadow puppet, two replay lessons and a demo set of hand shapes).
        817 attempts are synthetic, with one finger pushed off; 333 are real frames from a glove capture. The AI Assistant is a small open model we tuned ourselves.
      </p>
    </section>
  );
}
