import { useCallback, useState } from 'react';
import { api, ApiError, type GenerateLessonResponse, type Lesson, type Skill } from '../../../api';

export const EXAMPLE_PROMPTS = ['Teach a forehand topspin to a beginner', 'Five-finger scale for a child', 'Serve toss and backspin serve'];

export interface GenerateHandle {
  prompt: string;
  setPrompt: (p: string) => void;
  skill: Skill | '';
  setSkill: (s: Skill | '') => void;
  busy: boolean;
  error: string | null;
  result: GenerateLessonResponse | null;
  /** Bumps on every generation so the editor below remounts with the fresh lesson. */
  generation: number;
  generate: () => Promise<void>;
  save: (lesson: Lesson) => Promise<Lesson>;
}

/** POST /api/lessons/generate for a natural-language prompt, and PUT /api/lessons/{id} to save the edited draft. */
export function useGenerate(): GenerateHandle {
  const [prompt, setPrompt] = useState('');
  const [skill, setSkill] = useState<Skill | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateLessonResponse | null>(null);
  const [generation, setGeneration] = useState(0);

  const generate = useCallback(async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.generateLesson({ prompt: prompt.trim(), skill: skill || undefined });
      setResult(r);
      setGeneration((g) => g + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [prompt, skill]);

  const save = useCallback((lesson: Lesson) => api.updateLesson(lesson), []);

  return { prompt, setPrompt, skill, setSkill, busy, error, result, generation, generate, save };
}
