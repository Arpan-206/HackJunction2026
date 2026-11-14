import { Button, Field } from '../../../components/ui';
import { FlowNav } from './FlowNav';
import { DEFAULT_SKILL_NAME, defaultMoveName, HANDS_SHORT, lessonTitle, nameOr, readModel, type PlannedMove } from './scratchDraft';

interface PublishScreenProps {
  planned: PlannedMove[];
  /** How many of `planned` are earlier moves that can be removed (the last one is the move just recorded). */
  earlier: number;
  /** The skill's name as typed, or null before the expert edits it (the default is offered then). */
  skillName: string | null;
  /** The lesson is added to a catalogue skill: its name is shown, not edited. */
  skillLocked: boolean;
  onSkillName: (t: string) => void;
  about: string;
  onAbout: (t: string) => void;
  onRename: (moveId: string, name: string) => void;
  masterName: string;
  onMasterName: (n: string) => void;
  onPublish: () => void;
  publishing: boolean;
  error: string | null;
  onBack: () => void;
  backLabel: string;
  onAddAnother: () => void;
  onDrop: (index: number) => void;
}

/** What was recorded for one move, in a plain sentence: takes, the reference take, how fingers are judged. */
function moveDetail(move: PlannedMove): string {
  const { choice, model } = move;
  const n = model.take_ids.length;
  const ref = readModel(model, model.take_ids).referenceN;
  return `${HANDS_SHORT[choice.hands]}. ${n} ${n === 1 ? 'take' : 'takes'}; take ${ref} is the reference. Each finger is judged by how steady you held it.`;
}

/**
 * Publish: the new skill gets its name here, after the expert has seen the takes. The skill's name, each move's name (one
 * field per move), an optional line about it and the expert's own name; then one primary button.
 */
export function PublishScreen(p: PublishScreenProps) {
  const { planned, earlier, skillName, skillLocked, onSkillName, about, onAbout, onRename, masterName, onMasterName, onPublish, publishing, error, onBack, backLabel, onAddAnother, onDrop } = p;
  const name = skillName ?? DEFAULT_SKILL_NAME;
  const one = planned.length === 1;
  return (
    <>
      <div className="scr-pub">
        <section className="scr-pub__fields" aria-label="Name your skill">
          {skillLocked ? (
            <div className="field">
              <span className="field__label">Skill</span>
              <p className="scr-pub__skill">{name}</p>
            </div>
          ) : (
            <Field label="Skill name" value={name} onChange={(e) => onSkillName(e.target.value)} placeholder={DEFAULT_SKILL_NAME} />
          )}
          {one && (
            <Field label="What this move is called" value={planned[0].choice.name} onChange={(e) => onRename(planned[0].choice.id, e.target.value)} placeholder={defaultMoveName(1)} />
          )}
          <Field label="One line about it (optional)" value={about} onChange={(e) => onAbout(e.target.value)} placeholder="Centre the clay with both palms, thumbs together" />
          <Field label="Your name" value={masterName} onChange={(e) => onMasterName(e.target.value)} placeholder="Expert name" />
        </section>

        <section className="scr-pub__summary" aria-labelledby="scr-pub-what">
          <h2 id="scr-pub-what" className="scr-h2">
            {skillLocked
              ? `${lessonTitle({ skillLocked, skillName }, planned.map((m, i) => nameOr(m.choice.name, defaultMoveName(i + 1))))}`
              : one
                ? `${nameOr(name, DEFAULT_SKILL_NAME)} teaches one move`
                : `${nameOr(name, DEFAULT_SKILL_NAME)} teaches ${planned.length} moves`}
          </h2>
          {planned.length === 0 && <p className="note">No move is recorded yet. Record one to publish the skill.</p>}
          <ol className="scr-pub__list">
            {planned.map((m, i) => (
              <li key={m.choice.id} className="scr-pub__item">
                {one ? (
                  <span className="scr-pub__move">{nameOr(m.choice.name, defaultMoveName(1))}</span>
                ) : (
                  <Field label={`Move ${i + 1} is called`} value={m.choice.name} onChange={(e) => onRename(m.choice.id, e.target.value)} placeholder={defaultMoveName(i + 1)} />
                )}
                <span className="scr-pub__detail">{moveDetail(m)}</span>
                {i < earlier && planned.length > 1 && (
                  <Button variant="ghost" className="scr-pub__drop" onClick={() => onDrop(i)} aria-label={`Remove ${nameOr(m.choice.name, defaultMoveName(i + 1))} from the skill`}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ol>
          <button type="button" className="scr-quiet" onClick={onAddAnother}>
            Add another move
          </button>
        </section>

        {error && (
          <p className="mst-alert mst-alert--error" role="alert">
            The skill was not published: {error}
          </p>
        )}
      </div>

      <FlowNav
        back={{ label: backLabel, onClick: onBack, disabled: publishing }}
        next={{
          label: publishing ? 'Publishing...' : skillLocked ? 'Publish lesson' : 'Publish skill',
          onClick: onPublish,
          disabled: publishing || !planned.length || !name.trim(),
          reason: !planned.length ? 'Record a move first.' : name.trim() ? undefined : 'Give the skill a name.',
        }}
      />
    </>
  );
}
