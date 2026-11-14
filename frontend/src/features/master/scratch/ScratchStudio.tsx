import { useEffect, useRef } from 'react';
import { PageHeader } from '../../../components/PageHeader';
import { ResumeNote } from '../files/ResumeNote';
import { SampleDataNotice } from '../files/SampleDataNotice';
import { prefersReducedMotion } from '../../shared/settings';
import { FlowProgress } from './FlowNav';
import { PublishScreen } from './PublishScreen';
import { RecordScreen } from './RecordScreen';
import { ReplayScreen } from './ReplayScreen';
import { reachableScreen, type Screen } from './scratchDraft';
import { useScratchFlow } from './useScratchFlow';
import './scratch.css';

/**
 * "Start from scratch" makes a new skill, one decision per screen: Record three to five takes on the live hand, Replay
 * the reference take as the apprentice will see it, then Publish, where the skill and its moves get their names. The
 * draft lives in sessionStorage, so a reload keeps the place.
 */
export function ScratchStudio() {
  const f = useScratchFlow();
  const { draft, screen } = f;
  const first = useRef(true);

  // Each screen starts at its top; the very first render keeps the browser's own scroll position.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [screen]);

  const reachable = (s: Screen) => reachableScreen({ ...draft, screen: s }) === s;

  return (
    <div className="scr">
      <PageHeader title="Start from scratch" actions={<FlowProgress current={screen} reachable={reachable} onGo={f.go} />} />
      <ResumeNote text={f.resumeNote} onCarryOn={f.dismissResume} onStartFresh={f.startFresh} />
      {screen !== 'replay' && <SampleDataNotice />}

      {screen === 'record' && (
        <RecordScreen
          key={draft.current.id}
          choice={draft.current}
          moveNumber={draft.moves.length + 1}
          forSkill={draft.skillLocked ? draft.skillName : null}
          takeIds={draft.takeIds[draft.current.id] ?? []}
          onTakeIds={(ids) => f.setTakeIds(draft.current.id, ids)}
          glove={f.glove}
          steadiness={f.steadiness}
          model={draft.model}
          onModel={f.setModel}
          onHands={f.setHands}
          onBack={draft.moves.length ? () => f.go('publish') : undefined}
          onNext={() => f.go('replay')}
        />
      )}
      {screen === 'replay' && draft.model && (
        <ReplayScreen choice={draft.current} model={draft.model} glove={f.glove} onBack={() => f.go('record')} onNext={() => f.go('publish')} onAddAnother={f.addAnother} />
      )}
      {screen === 'publish' && (
        <PublishScreen
          planned={f.planned}
          earlier={draft.moves.length}
          skillName={draft.skillName}
          skillLocked={draft.skillLocked}
          onSkillName={f.setSkillName}
          about={draft.about}
          onAbout={f.setAbout}
          onRename={f.renameMove}
          masterName={draft.masterName}
          onMasterName={f.setMasterName}
          onPublish={() => void f.publish()}
          publishing={f.publishing}
          error={f.publishError}
          onBack={() => f.go(draft.model ? 'replay' : 'record')}
          backLabel={draft.model ? 'Back to replay' : 'Back to recording'}
          onAddAnother={f.addAnother}
          onDrop={f.dropMove}
        />
      )}
    </div>
  );
}
