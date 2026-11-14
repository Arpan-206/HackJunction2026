import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type GenerateLessonResponse, type Lesson, type Skill } from '../../../api';

export const EXAMPLE_PROMPTS = ['Teach a forehand topspin to a beginner', 'Five-finger scale for a child', 'Serve toss and backspin serve'];

/** The backend refuses larger clips with a 413. */
export const VIDEO_MAX_MB = 50;
const VIDEO_MAX_BYTES = VIDEO_MAX_MB * 1024 * 1024;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/** Returns a plain-words reason a file cannot be uploaded, or null when it is fine. */
export function videoProblem(file: { name: string; type: string; size: number }): string | null {
  if (!VIDEO_EXT.test(file.name) && !VIDEO_TYPES.includes(file.type)) return 'That file is not a video the maestro can read. Use an mp4, webm or mov clip.';
  if (file.size > VIDEO_MAX_BYTES) return `That clip is ${(file.size / 1024 / 1024).toFixed(0)} MB. Keep it under ${VIDEO_MAX_MB} MB.`;
  return null;
}

export interface GenerateHandle {
  prompt: string;
  setPrompt: (p: string) => void;
  skill: Skill | '';
  setSkill: (s: Skill | '') => void;
  busy: boolean;
  error: string | null;
  result: GenerateLessonResponse | null;
  /** Where the current result came from, so the provider line can be honest about it. */
  source: 'text' | 'video';
  /** Bumps on every generation so the editor below remounts with the fresh lesson. */
  generation: number;
  generate: () => Promise<void>;
  save: (lesson: Lesson) => Promise<Lesson>;
  video: File | null;
  /** Chooses a clip; a file that fails the client-side check is refused and explained in `videoError`. */
  pickVideo: (file: File | null) => void;
  videoError: string | null;
  /** Upload progress, 0 to 100; null when nothing is uploading. */
  progress: number | null;
  generateFromVideo: () => Promise<void>;
  /** Runs whichever of the two drafts was attempted last again. */
  retry: () => Promise<void>;
}

/**
 * POST /api/lessons/generate for a natural-language prompt or POST /api/lessons/generate_from_video for a clip,
 * and PUT /api/lessons/{id} to save the edited draft. Both routes feed the same editable result.
 */
export function useGenerate(): GenerateHandle {
  const [prompt, setPrompt] = useState('');
  const [skill, setSkill] = useState<Skill | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateLessonResponse | null>(null);
  const [source, setSource] = useState<'text' | 'video'>('text');
  const [generation, setGeneration] = useState(0);
  const [video, setVideo] = useState<File | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const last = useRef<'text' | 'video'>('text');

  useEffect(() => () => ctl.current?.abort(), []);

  const finish = (r: GenerateLessonResponse, from: 'text' | 'video') => {
    setResult(r);
    setSource(from);
    setGeneration((g) => g + 1);
  };

  const generate = useCallback(async () => {
    if (!prompt.trim()) return;
    last.current = 'text';
    setBusy(true);
    setError(null);
    try {
      finish(await api.generateLesson({ prompt: prompt.trim(), skill: skill || undefined }), 'text');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [prompt, skill]);

  const pickVideo = useCallback((file: File | null) => {
    setError(null);
    if (!file) {
      setVideo(null);
      setVideoError(null);
      return;
    }
    const problem = videoProblem(file);
    setVideoError(problem);
    setVideo(problem ? null : file);
  }, []);

  const generateFromVideo = useCallback(async () => {
    if (!video) return;
    last.current = 'video';
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      finish(await api.generateLessonFromVideo(video, { prompt: prompt.trim() || undefined, skill: skill || undefined }, setProgress, mine.signal), 'video');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [video, prompt, skill]);

  const retry = useCallback(() => (last.current === 'video' ? generateFromVideo() : generate()), [generate, generateFromVideo]);

  const save = useCallback((lesson: Lesson) => api.updateLesson(lesson), []);

  return { prompt, setPrompt, skill, setSkill, busy, error, result, source, generation, generate, save, video, pickVideo, videoError, progress, generateFromVideo, retry };
}
