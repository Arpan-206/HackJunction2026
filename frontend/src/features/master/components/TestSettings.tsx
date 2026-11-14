import { useId } from 'react';
import type { Skill, TestSpec } from '../../../api';
import { Button, Card, Field } from '../../../components/ui';

interface TestSettingsProps {
  skill: Skill;
  test: TestSpec | null;
  onChange: (t: TestSpec | null) => void;
}

function defaultTest(skill: Skill): TestSpec {
  if (skill === 'touch_typing') return { kind: 'air_typing', opponent: 'bot', rounds: 3 };
  return skill === 'piano' ? { kind: 'piano_play_along', opponent: 'bot', rounds: 3 } : { kind: 'table_tennis_rally', opponent: 'bot', rounds: 3 };
}

/** Settings for the "Test your skills" finale of a lesson (TestSpec), or none. */
export function TestSettings({ skill, test, onChange }: TestSettingsProps) {
  const kindId = useId();
  const oppId = useId();
  return (
    <Card title="Test your skills" className="mst-test">
      <p className="note">The finale an apprentice plays once every step is practised.</p>
      {!test ? (
        <Button variant="secondary" onClick={() => onChange(defaultTest(skill))}>
          Add a finale
        </Button>
      ) : (
        <div className="mst-test__grid">
          <div className="field">
            <label className="field__label" htmlFor={kindId}>
              Kind
            </label>
            <select id={kindId} className="field__control" value={test.kind} onChange={(e) => onChange({ ...test, kind: e.target.value as TestSpec['kind'] })}>
              <option value="table_tennis_rally">Table tennis rally</option>
              <option value="piano_play_along">Piano play-along</option>
              <option value="air_typing">Air typing</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={oppId}>
              Opponent
            </label>
            <select id={oppId} className="field__control" value={test.opponent} onChange={(e) => onChange({ ...test, opponent: e.target.value as TestSpec['opponent'] })}>
              <option value="bot">Practice bot</option>
              <option value="two_player">Two players (left glove against right)</option>
            </select>
          </div>
          <Field label="Rounds" type="number" min={1} max={20} value={test.rounds} onChange={(e) => onChange({ ...test, rounds: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
          <Button variant="ghost" onClick={() => onChange(null)}>
            Remove the finale
          </Button>
        </div>
      )}
    </Card>
  );
}
