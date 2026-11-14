import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Lesson } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink, Card, TextArea } from '../../../components/ui';
import { ASSISTANT_OFF, useAssistant } from '../../shared/assistant';
import { LessonEditor } from '../components/LessonEditor';
import { blankStep, newStepId, SKILLS } from '../lib';
import { EXAMPLE_PROMPTS, useGenerate, VIDEO_MAX_MB } from './useGenerate';

/** Who drafted the plan, in plain words. Provider names stay in the developer panel. */
function draftNote(provider: string, video: boolean): string {
  // 'fake' is the offline template the backend falls back to; 'fake (rate limited)' when the free budget is spent.
  if (provider.startsWith('fake')) return video ? 'The AI Assistant could not watch the clip, so this is a starting template.' : 'The AI Assistant was unavailable, so this is a starting template.';
  return video ? 'The AI Assistant watched your clip and drafted these steps.' : 'The AI Assistant drafted these steps.';
}

/** A lesson with one empty step, for writing the steps by hand while the AI Assistant is off. */
function blankLesson(): Lesson {
  return { id: `l_${newStepId().slice(2)}`, title: '', skill: 'general', summary: '', master_name: 'The expert', source: 'scratch', steps: [blankStep()], test: null, created_at: new Date().toISOString() };
}

/** "Generate steps": describe a lesson in plain words, review the drafted steps, record real takes, save. */
export function GenerateSteps() {
  const g = useGenerate();
  const navigate = useNavigate();
  const skillId = useId();
  const videoId = useId();
  const [assistant, setAssistant] = useAssistant();
  const [manual, setManual] = useState<Lesson | null>(null);

  const save = async (lesson: Lesson) => {
    const saved = await g.save(lesson);
    navigate(`/expert/lessons/${saved.id}`);
    return saved;
  };

  return (
    <>
      <PageHeader title="Generate steps" context="Describe the skill; the AI Assistant drafts a plan for you to adjust before recording." />

      {!assistant && (
        <Card className="mst-gen">
          <p className="mst-line">{ASSISTANT_OFF.draft}</p>
          <div className="mst-gen__row">
            <Button onClick={() => setAssistant(true)}>Turn the AI Assistant on</Button>
            <Button variant="secondary" disabled={Boolean(manual)} onClick={() => setManual(blankLesson())}>
              Write the steps yourself
            </Button>
            <ButtonLink variant="ghost" to="/expert/scratch">
              Start from scratch instead
            </ButtonLink>
          </div>
        </Card>
      )}
      {!assistant && manual && (
        <section className="mst-section" aria-label="Lesson written by hand">
          <LessonEditor lesson={manual} onSave={save} saveLabel="Save lesson" />
        </section>
      )}

      {assistant && (
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
                <option value="">Let the AI Assistant decide</option>
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
              <span className="field__hint">mp4, webm or mov, up to {VIDEO_MAX_MB} MB. Any words above guide what the AI Assistant looks for.</span>
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
                {g.progress < 100 ? `Handing the clip to the AI Assistant, ${g.progress} per cent.` : 'The AI Assistant is watching your clip and sketching the steps. This can take up to two minutes.'}
              </p>
              <div className="mst-video__progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.progress}>
                <div className="mst-video__bar" style={{ transform: `scaleX(${Math.max(g.progress, 2) / 100})` }} />
              </div>
            </div>
          )}
          {g.busy && g.progress === null && (
            <p className="note mst-busy" role="status">
              The AI Assistant is sketching your lesson on the cartone. This can take a few seconds.
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
      )}

      {g.result && (
        <section className="mst-section" aria-label="Generated lesson">
          <div className="mst-provider">
            <p className="mst-gen__provider">
              {draftNote(g.result.provider, g.source === 'video')}
            </p>
          </div>
          <LessonEditor key={g.generation} lesson={g.result.lesson} onSave={save} saveLabel="Save lesson" />
        </section>
      )}
    </>
  );
}
