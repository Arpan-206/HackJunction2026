import { useState } from 'react';
import type { Skill } from '../../../api';
import { Button, Field, Tabs } from '../../../components/ui';
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

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const numberWord = (n: number): string => WORDS[n] ?? String(n);

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
            <span className="mst-move__meta note">
              {numberWord(m.default_repetitions)} takes, {m.hands === 'both' ? 'both hands' : `${m.hands} hand`}
            </span>
          </button>
        );
      })}
      <div className={`mst-move mst-move--free ${freeActive ? 'is-active' : ''}`}>
        <span className="mst-move__name">Free move</span>
        <span className="mst-move__desc note">Record any movement of your own and name it. It is labelled for training data like the rest.</span>
        <Field label="Name of the move" value={freeName} placeholder="Topspin loop" onChange={(e) => setFreeName(e.target.value)} />
        <Button variant="secondary" disabled={!freeName.trim()} onClick={() => onChoose(freeChoice(freeName, skill))}>
          Use this move
        </Button>
        {!freeName.trim() && <span className="reason">Name the move to use it.</span>}
      </div>
    </div>
  );

  return (
    <div className="mst-picker">
      {catalogue.offline && (
        <div className="mst-alert" role="status">
          <p>The pattern book could not be reached, so a small local set of moves is shown. Check that the backend is running.</p>
          <Button variant="secondary" onClick={catalogue.retry}>
            Try again
          </Button>
        </div>
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
