import { describe, expect, it } from 'vitest';
import { toJsx } from '../src/playground/jsx';

describe('toJsx', () => {
  it('skips undefined props and writes booleans and numbers as JSX', () => {
    expect(toJsx('Button', { variant: 'ghost', large: true, disabled: false, n: 3, gone: undefined })).toBe(
      '<Button variant="ghost" large disabled={false} n={3} />',
    );
  });

  it('writes objects as inline literals with bare keys', () => {
    expect(toJsx('Hand', { motion: { preset: 'finger_sequence', sequence: [1, 2], beat_ms: 620 } })).toContain(
      'motion={{ preset: "finger_sequence", sequence: [1, 2], beat_ms: 620 }}',
    );
  });

  it('wraps children', () => {
    expect(toJsx('Card', { title: 'Hi' }, 'Body')).toBe('<Card title="Hi">\n  Body\n</Card>');
  });
});
