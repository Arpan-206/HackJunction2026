import { describe, expect, it } from 'vitest';
import { isOfflineProvider, modelLabel } from '../src/features/shared/providerLabel';

describe('modelLabel', () => {
  it('names only the AI Assistant for learners and experts', () => {
    for (const provider of ['gemini', 'openai', 'mock']) expect(modelLabel(provider, false)).toBe('AI Assistant');
    for (const provider of ['offline', 'fake', 'fake (rate limited)']) expect(modelLabel(provider, false)).toBe('AI Assistant offline');
    for (const provider of ['gemini', 'openai', 'offline', 'fake']) {
      const text = modelLabel(provider, false) ?? '';
      expect(text).not.toMatch(/Gemini|Gemma|Verda|coach/);
    }
  });

  it('names the model in dev mode', () => {
    expect(modelLabel('gemini', true)).toBe('answered by Gemini');
    expect(modelLabel('openai', true)).toBe('answered by Gemma on Verda');
    expect(modelLabel('offline', true)).toBe('AI Assistant offline (offline)');
  });

  it('gives no label to the rule-based cue outside dev mode', () => {
    expect(modelLabel('algorithmic', false)).toBeNull();
    expect(modelLabel('algorithm', false)).toBeNull();
    expect(modelLabel('algorithmic', true)).toBe('answered by the rule-based cue');
  });

  it('treats templates and the offline note as offline', () => {
    expect(isOfflineProvider('offline')).toBe(true);
    expect(isOfflineProvider('fake (rate limited)')).toBe(true);
    expect(isOfflineProvider('gemini')).toBe(false);
  });
});
