import { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Lesson } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Badge, Button, Card, TextArea } from '../../../components/ui';
import { LessonEditor } from '../components/LessonEditor';
import { SKILLS } from '../lib';
import { EXAMPLE_PROMPTS, useGenerate } from './useGenerate';

const providerNote: Record<string, string> = {
  fake: 'An offline template drafted this plan, no language model was used.',
  gemini: 'Drafted by Gemini.',
  ollama: 'Drafted by the local Gemma model.',
};

/** "Generate steps": describe a lesson in plain words, review the drafted steps, record real takes, save. */
export function GenerateSteps() {
  const g = useGenerate();
  const navigate = useNavigate();
  const skillId = useId();

  const save = async (lesson: Lesson) => {
    const saved = await g.save(lesson);
    navigate(`/master/lessons/${saved.id}`);
    return saved;
  };

  return (
    <>
      <PageHeader kicker="Il maestro" title="Generate steps" />

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
        </div>
        {g.busy && (
          <p className="note mst-busy" role="status">
            The maestro is sketching your lesson on the cartone. This can take a few seconds.
          </p>
        )}
        {g.error && (
          <p className="mst-alert" role="alert">
            Could not draft the lesson: {g.error}
          </p>
        )}
      </Card>

      {g.result && (
        <section className="mst-section" aria-label="Generated lesson">
          <div className="mst-provider">
            <Badge tone="lapis">{g.result.provider}</Badge>
            <span className="note">
              {providerNote[g.result.provider] ?? `Drafted by ${g.result.provider}.`} {g.result.attempts} {g.result.attempts === 1 ? 'attempt' : 'attempts'}.
            </span>
          </div>
          <LessonEditor key={g.generation} lesson={g.result.lesson} onSave={save} saveLabel="Save lesson" />
        </section>
      )}
    </>
  );
}
