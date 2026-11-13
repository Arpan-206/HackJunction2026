import { useState } from 'react';
import type { Skill } from '../../../api';
import { Badge, Button, Field, Tabs } from '../../../components/ui';
import type { MoveCatalogue } from '../hooks/useMoveCatalogue';
import { SKILLS, choiceFromMove, freeChoice, type MoveChoice, primarySide } from '../lib';
import { GuideHand } from './GuideHand';

interface MovePickerProps {
  catalogue: MoveCatalogue;
  skill: Skill;
  onSkill: (s: Skill) => void;
  choice: MoveChoice | null;
  onChoose: (c: MoveChoice) => void;
}

/** Pick a skill, then a move from the catalogue (each with a looping preview hand) or invent a free move. */
export function MovePicker({ catalogue, skill, onSkill, choice, onChoose }: MovePickerProps) {
  const [freeName, setFreeName] = useState('');
  const moves = catalogue.moves.filter((m) => m.skill === skill);
  const freeActive = choice?.moveId === null && choice.skill === skill;

  const grid = (
    <div className="mst-moves">
      {catalogue.loading && <p className="note">Opening the pattern book...</p>}
      {moves.map((m) => {
        const active = choice?.id === m.id;
        return (
          <button key={m.id} type="button" className={`mst-move ${active ? 'is-active' : ''}`} aria-pressed={active} onClick={() => onChoose(choiceFromMove(m))}>
            <GuideHand label={`${m.name} preview`} motion={m.default_motion} side={primarySide(m.hands)} prop={m.prop} />
            <span className="mst-move__name">{m.name}</span>
            <span className="mst-move__desc note">{m.description}</span>
            <span className="mst-move__meta">
              <Badge>{m.default_repetitions} takes</Badge>
              <Badge>{m.hands === 'both' ? 'Both hands' : `${m.hands} hand`}</Badge>
            </span>
          </button>
        );
      })}
      <div className={`mst-move mst-move--free ${freeActive ? 'is-active' : ''}`}>
        <span className="mst-move__name">Free move</span>
        <span className="mst-move__desc note">Record any movement of your own and name it. It is labelled for training data like the rest.</span>
        <Field label="Name of the move" value={freeName} placeholder="Topspin loop" onChange={(e) => setFreeName(e.target.value)} />
        <Button variant={freeActive ? 'primary' : 'secondary'} disabled={!freeName.trim()} onClick={() => onChoose(freeChoice(freeName, skill))}>
          Record this move
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mst-picker">
      {catalogue.offline && (
        <p className="mst-alert" role="status">
          The backend is not answering ({catalogue.errorMessage}). A small local set of moves is shown so you can still look around.
        </p>
      )}
      <Tabs
        label="Skill"
        value={skill}
        onChange={(id) => onSkill(id as Skill)}
        tabs={SKILLS.map((s) => ({ id: s.id, label: s.label, content: s.id === skill ? grid : null }))}
      />
    </div>
  );
}
