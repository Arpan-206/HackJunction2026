import { isDev } from '../apprentice/pipeline/flags';
import type { ModelProvider } from '../../api/types';

/** Model names, shown only while the dev panel is on for this tab (CLAUDE.md rule 6). */
const DEV_NAMES: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'Gemma on Verda',
  mock: 'the mock templates',
};

/** True when no language model answered: the coach's offline note, or a template after every model failed. */
export function isOfflineProvider(provider: ModelProvider): boolean {
  return provider === 'offline' || provider.startsWith('fake');
}

/**
 * The small "who answered" label for a `provider` field. Learners and experts see "AI Assistant" or "AI Assistant
 * offline"; with ?dev=1 the label names the model. Returns null for the rule-based cue, which is not the AI Assistant.
 */
export function modelLabel(provider: ModelProvider, dev: boolean = isDev()): string | null {
  if (provider === 'algorithmic' || provider === 'algorithm') return dev ? 'answered by the rule-based cue' : null;
  if (isOfflineProvider(provider)) return dev ? `AI Assistant offline (${provider})` : 'AI Assistant offline';
  if (dev) return `answered by ${DEV_NAMES[provider] ?? provider}`;
  return 'AI Assistant';
}
