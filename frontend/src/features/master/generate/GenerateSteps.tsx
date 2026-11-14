import { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Lesson } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, TextArea } from '../../../components/ui';
import { LessonEditor } from '../components/LessonEditor';
import { SKILLS } from '../lib';
import { EXAMPLE_PROMPTS, useGenerate, VIDEO_MAX_MB } from './useGenerate';

const providerNote: Record<string, string> = {
  fake: 'An offline template drafted this plan, no language model was used.',
  gemini: 'Drafted by Gemini.',
  ollama: 'Drafted by the local Gemma model.',
};

const videoProviderNote: Record<string, string> = {
  fake: 'Video analysis needs Gemini; this is an offline template.',
  gemini: 'Gemini watched your clip and drafted this plan.',
  ollama: 'The local Gemma model cannot watch video; this is an offline template.',
};

/** "Generate steps": describe a lesson in plain words, review the drafted steps, record real takes, save. */
export function GenerateSteps() {
  const g = useGenerate();
  const navigate = useNavigate();
  const skillId = useId();
  const videoId = useId();
  const note = (g.source === 'video' ? videoProviderNote : providerNote)[g.result?.provider ?? ''];

  const save = async (lesson: Lesson) => {
    const saved = await g.save(lesson);
    navigate(`/expert/lessons/${saved.id}`);
    return saved;
  };

  return (
    <>
      <PageHeader title="Generate steps" context="Describe the skill; a plan is drafted for you to adjust before recording." />

      <Card className="mst-gen">
        <TextArea
          label="What should the apprentice learn?"
          hint="Describe the skill in your own words: who it is for and what it should feel like."
          value={g.prompt}
          rows={3}
          placeholder="Teach a forehand topspin to a beginner"
          onChange={(e) => g.setPrompt(e.target.value)}
        />
        <div className="mst-chips" role="group" aria-label="Example prompts">
          {EXAMPLE_PROMPTS.map((p) => (
            <Button key={p} variant="secondary" onClick={() => g.setPrompt(p)}>
              {p}
            </Button>
          ))}
        </div>
        <div className="mst-gen__row">
          <div className="field">
            <label className="field__label" htmlFor={skillId}>
              Skill (optional)
            </label>
            <select id={skillId} className="field__control" value={g.skill} onChange={(e) => g.setSkill(e.target.value as typeof g.skill)}>
              <option value="">Let the maestro decide</option>
              {SKILLS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <Button large onClick={() => void g.generate()} disabled={g.busy || !g.prompt.trim()}>
            {g.busy ? 'Sketching...' : 'Generate steps'}
          </Button>
          {!g.prompt.trim() && <span className="reason">Describe the skill to draft steps.</span>}
        </div>
        <div className="mst-video">
          <h2 className="mst-video__title">Or draft from a video</h2>
          <div className="field">
            <label className="field__label" htmlFor={videoId}>
              A clip of the movement
            </label>
            <span className="field__hint">mp4, webm or mov, up to {VIDEO_MAX_MB} MB. Any words above guide what the maestro looks for.</span>
            <input
              id={videoId}
              className="mst-video__file"
              type="file"
              accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
              disabled={g.busy}
              onChange={(e) => {
                g.pickVideo(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </div>
          {g.videoError && (
            <p className="mst-alert mst-alert--error" role="alert">
              {g.videoError}
            </p>
          )}
          {g.video && (
            <div className="mst-video__row">
              <span className="note">
                {g.video.name}, {(g.video.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <Button large variant="secondary" onClick={() => void g.generateFromVideo()} disabled={g.busy}>
                {g.busy && g.progress !== null ? 'Watching...' : 'Draft from this video'}
              </Button>
            </div>
          )}
        </div>
        {g.busy && g.progress !== null && (
          <div className="mst-busy" role="status">
            <p className="note">
              {g.progress < 100 ? `Handing the clip to the maestro, ${g.progress} per cent.` : 'The maestro is watching your clip and sketching the steps. This can take up to two minutes.'}
            </p>
            <div className="mst-video__progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.progress}>
              <div className="mst-video__bar" style={{ transform: `scaleX(${Math.max(g.progress, 2) / 100})` }} />
            </div>
          </div>
        )}
        {g.busy && g.progress === null && (
          <p className="note mst-busy" role="status">
            The maestro is sketching your lesson on the cartone. This can take a few seconds.
          </p>
        )}
        {g.error && (
          <div className="mst-alert mst-alert--error" role="alert">
            <p>The lesson could not be drafted. Check that the backend is running, then try again.</p>
            <Button variant="secondary" onClick={() => void g.retry()}>
              Try again
            </Button>
          </div>
        )}
      </Card>

      {g.result && (
        <section className="mst-section" aria-label="Generated lesson">
          <div className="mst-provider">
            <p className="mst-gen__provider">
              {note ?? `Drafted by ${g.result.provider}.`} {g.result.attempts} {g.result.attempts === 1 ? 'attempt' : 'attempts'}.
            </p>
          </div>
          <LessonEditor key={g.generation} lesson={g.result.lesson} onSave={save} saveLabel="Save lesson" />
        </section>
      )}
    </>
  );
}
