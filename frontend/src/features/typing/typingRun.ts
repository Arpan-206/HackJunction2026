import { FINGER_ROWS, fingerName, handFingerName, normalizeKey, rowOfKey, SPACE, type FingerRow, type TypingFinger, type TypingSide } from './chart';

/** The core's verdict on which finger pressed a key (`keystroke` event data, core/tasks/typing.py). */
export type FingerVerdictName = 'good' | 'wrong_finger' | 'unclear';

export interface FingerVerdict {
  id: number;
  key: string;
  verdict: FingerVerdictName;
  expected: { hand: TypingSide; finger: TypingFinger }[];
  detected: { hand: TypingSide; finger: TypingFinger } | null;
  reason: 'no_press' | 'ambiguous' | null;
  confidence: number;
  peak_deg_s?: number;
  source?: 'press' | 'velocity' | null;
  simulated?: boolean;
}

/** One keydown on a chart key while a drill runs. */
export interface Attempt {
  /** Position in the drill text when the key went down. */
  pos: number;
  target: string;
  typed: string;
  keyOk: boolean;
  /** Id the core gave this keystroke in its ack, once the ack is back. */
  coreId: number | null;
  finger: FingerVerdict | null;
}

export interface Run {
  text: string;
  pos: number;
  attempts: Attempt[];
  /** Verdicts that arrived before their ack (kept until the ack links them). */
  early: Record<number, FingerVerdict>;
}

export interface TallyRow {
  keys: number;
  rightKey: number;
  good: number;
  wrongFinger: number;
  unclear: number;
}

export function newRun(text: string): Run {
  return { text, pos: 0, attempts: [], early: {} };
}

export function done(run: Run): boolean {
  return run.pos >= run.text.length;
}

/** Records one keydown. Returns null for keys off the chart (Shift, Enter, arrows). A wrong key does not move the cursor. */
export function pressKey(run: Run, rawKey: string): { run: Run; index: number } | null {
  const typed = normalizeKey(rawKey);
  if (typed === null || done(run)) return null;
  const target = normalizeKey(run.text[run.pos]) ?? run.text[run.pos];
  const keyOk = typed === target;
  const a: Attempt = { pos: run.pos, target, typed, keyOk, coreId: null, finger: null };
  return { run: { ...run, pos: keyOk ? run.pos + 1 : run.pos, attempts: [...run.attempts, a] }, index: run.attempts.length };
}

/** Links the core's keystroke id (from the ack) to an attempt, picking up a verdict that came first. */
export function linkCore(run: Run, index: number, coreId: number): Run {
  const a = run.attempts[index];
  if (!a) return run;
  const finger = run.early[coreId] ?? a.finger;
  const early = { ...run.early };
  delete early[coreId];
  const attempts = run.attempts.slice();
  attempts[index] = { ...a, coreId, finger };
  return { ...run, attempts, early };
}

/** Attaches a `keystroke` event's verdict to its attempt. */
export function applyVerdict(run: Run, v: FingerVerdict): Run {
  const i = run.attempts.findIndex((a) => a.coreId === v.id);
  if (i < 0) return { ...run, early: { ...run.early, [v.id]: v } };
  const attempts = run.attempts.slice();
  attempts[i] = { ...attempts[i], finger: v };
  return { ...run, attempts };
}

/** Per finger row, counted under the finger the chart gives the key that should have been typed. */
export function tally(run: Run): Record<FingerRow, TallyRow> {
  const out = Object.fromEntries(FINGER_ROWS.map((r) => [r, { keys: 0, rightKey: 0, good: 0, wrongFinger: 0, unclear: 0 }])) as Record<FingerRow, TallyRow>;
  for (const a of run.attempts) {
    const row = rowOfKey(a.target);
    if (!row) continue;
    const t = out[row];
    t.keys += 1;
    if (a.keyOk) t.rightKey += 1;
    if (a.finger?.verdict === 'good') t.good += 1;
    else if (a.finger?.verdict === 'wrong_finger') t.wrongFinger += 1;
    else if (a.finger?.verdict === 'unclear') t.unclear += 1;
  }
  return out;
}

export function totals(run: Run): TallyRow {
  const t = { keys: 0, rightKey: 0, good: 0, wrongFinger: 0, unclear: 0 };
  for (const r of Object.values(tally(run))) {
    t.keys += r.keys;
    t.rightKey += r.rightKey;
    t.good += r.good;
    t.wrongFinger += r.wrongFinger;
    t.unclear += r.unclear;
  }
  return t;
}

function keyLabel(k: string): string {
  return k === SPACE ? 'the space bar' : k.length === 1 && /[a-z]/.test(k) ? k.toUpperCase() : `“${k}”`;
}

export type LineTone = 'ok' | 'fix' | 'plain';

/** The one line the screen shows about an attempt: key first, then finger. */
export function lineFor(a: Attempt, gloves: boolean): { tone: LineTone; text: string } {
  const row = rowOfKey(a.target);
  const use = row ? fingerName(row) : 'the chart finger';
  if (!a.keyOk) return { tone: 'fix', text: `That was ${keyLabel(a.typed)}. Type ${keyLabel(a.target)} with your ${use}.` };
  if (!gloves) return { tone: 'plain', text: `Right key. Use your ${use} for ${keyLabel(a.target)}.` };
  if (!a.finger) return { tone: 'plain', text: 'Right key. Checking the finger…' };
  if (a.finger.verdict === 'good') return { tone: 'ok', text: `Right key, right finger: ${use}.` };
  if (a.finger.verdict === 'wrong_finger' && a.finger.detected) {
    return { tone: 'fix', text: `Right key, wrong finger. You used your ${handFingerName(a.finger.detected.hand, a.finger.detected.finger)}. Use your ${use}.` };
  }
  return {
    tone: 'plain',
    text: a.finger.reason === 'ambiguous' ? 'Right key. Two fingers moved alike, so the gloves could not tell which one pressed.' : 'Right key. The gloves felt no clear press.',
  };
}
