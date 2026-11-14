import { useParams, Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import '../features/master/master.css';
import './design.css';
import './learner.css';
import './test.css';
import { ExpertRecording, ExpertReview, ExpertScore, ExpertSetup } from './frames/Expert';
import { LearnerHome, SkillPage } from './frames/Learner';
import { RoomBlind, RoomGhost, RoomHandoff, RoomWatch } from './frames/Room';
import { ScoreLearned, ScoreRep } from './frames/Score';
import { TestDiagnostics, TestMatch, Turntable } from './frames/Test';

/**
 * Round 3 design prototypes: every frame of the design board as a working screen with static sample data and a real 3D
 * stage. Never touches the backend. Open /design for the list, /design/<id> for one frame, ?freeze=1 to hold poses.
 */
export const FRAMES: { id: string; title: string; C: ComponentType }[] = [
  { id: 'expert-setup', title: '1a Expert studio, set-up before the first take', C: ExpertSetup },
  { id: 'expert-recording', title: '1b Expert studio, recording take 3', C: ExpertRecording },
  { id: 'expert-review', title: '1c Expert studio, review takes of a two-hand move', C: ExpertReview },
  { id: 'learner-home', title: '2a Learner skill dashboard (?q= for search and no results)', C: LearnerHome },
  { id: 'skill-page', title: '2d Skill page with the 3D showcase', C: SkillPage },
  { id: 'room-watch', title: '3a Training room, Watch', C: RoomWatch },
  { id: 'room-handoff', title: '3b Hand-off, three moments (?m=1, 2, 3)', C: RoomHandoff },
  { id: 'room-ghost', title: '3c Training inside the ghost', C: RoomGhost },
  { id: 'room-blind', title: '3d Blind rep', C: RoomBlind },
  { id: 'score-rep', title: '4a Score after a rep', C: ScoreRep },
  { id: 'score-learned', title: '4b Step learned', C: ScoreLearned },
  { id: 'expert-score', title: '4c Expert take scored against kept takes', C: ExpertScore },
  { id: 'test-match', title: '5a Test your skills, live match', C: TestMatch },
  { id: 'test-diagnostics', title: '5b After the match, diagnostics on parchment', C: TestDiagnostics },
  { id: 'turntable', title: 'Turntable still for the board', C: Turntable },
];

export default function DesignRoute() {
  const { frame } = useParams();
  const hit = FRAMES.find((f) => f.id === frame);
  if (hit) return <hit.C />;
  return (
    <main style={{ padding: 32, display: 'grid', gap: 12 }}>
      <h1>Design round 3</h1>
      <p>Prototype frames with static sample data. Add ?freeze=1 to hold every pose.</p>
      <ul style={{ display: 'grid', gap: 8, fontSize: 20 }}>
        {FRAMES.map((f) => (
          <li key={f.id}>
            <Link to={`/design/${f.id}`}>{f.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
