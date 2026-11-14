import { useRef } from 'react';
import { Hand, type HandHandle } from '../../three';
import { Frame, Key, Primary, Steps, Tick } from '../kit';
import { Leaders, type LeaderNote } from '../Leaders';
import { ScorePlaque, StreakCandle, WaxSeal } from '../guild3d';
import { SCALE, offFinger } from '../poses';
import { SceneCanvas, onHand, play, useBoard } from '../scene';

const CAM = { position: [0.9, 4.3, 5.4] as [number, number, number], target: [0, -0.2, -1.05] as [number, number, number] };
const T = 1.99;

function ScoreScene({ learned }: { learned: boolean }) {
  const board = useBoard();
  const hand = useRef<HandHandle>(null);
  board
    .set('thumb', onHand(hand, 'thumb'))
    .set('index', onHand(hand, 'index'))
    .set('middle', onHand(hand, 'middle'))
    .set('ring', onHand(hand, 'ring'))
    .set('little', onHand(hand, 'little'));
  // The hand lies thumb side to the camera with its fingers to the left, so every finger shows in profile; the tags stack
  // down the left in the order of the tips, so no leader crosses another or the hand.
  const notes: LeaderNote[] = learned
    ? [
        { id: 'little', side: 'left', top: 150, width: 190, tone: 'ok', title: 'Little 91' },
        { id: 'ring', side: 'left', top: 240, width: 190, tone: 'ok', title: 'Ring 90' },
        { id: 'middle', side: 'left', top: 330, width: 190, tone: 'ok', title: 'Middle 95' },
        { id: 'index', side: 'left', top: 420, width: 190, tone: 'ok', title: 'Index 92' },
        { id: 'thumb', side: 'left', top: 540, width: 190, tone: 'ok', title: 'Thumb 94' },
      ]
    : [
        { id: 'little', side: 'left', top: 130, width: 190, tone: 'ok', title: 'Little 85' },
        { id: 'ring', side: 'left', top: 210, width: 230, tone: 'fix', title: 'Ring 71', body: 'Pressed late, 14 degrees short.' },
        { id: 'middle', side: 'left', top: 340, width: 190, tone: 'ok', title: 'Middle 90' },
        { id: 'index', side: 'left', top: 420, width: 190, tone: 'ok', title: 'Index 88' },
        { id: 'thumb', side: 'left', top: 540, width: 190, tone: 'ok', title: 'Thumb 92' },
      ];
  return (
    <section className="dz-stage" aria-label="Score">
      <SceneCanvas world="bench" {...CAM} board={board} bench={{ circle: 0, showShadow: true, props: false }} label={`The learner's wooden hand on the bench with a plaster score plaque, a wax rank seal${learned ? ' inlaid with gold leaf' : ''} and a lit streak candle`}>
        <Hand ref={hand} style="wood" side="right" position={[1.45, 0, 0.1]} rotation={[0, Math.PI / 2, 0]} getFrame={learned ? play(SCALE, T) : offFinger(SCALE, T, 3, 0.35)} />
        <group position={[0, -0.55, -2.55]} scale={0.8}>
          <ScorePlaque position={[0, 0, 0]} score={learned ? '93' : '86'} line={learned ? 'Step 2 learned' : 'Rep 3 of 5'} learned={learned} />
        </group>
        <StreakCandle position={[-1.15, -0.55, -2.2]} />
        <WaxSeal position={[1.12, -0.55, -2.15]} rank="Apprentice" learned={learned} />
      </SceneCanvas>
      <Leaders board={board} notes={notes} world="field" />
    </section>
  );
}

/** 4a. Score after a rep: Guild Hall objects on the bench, finger tags on leader lines, Next rep on Space. */
export function ScoreRep() {
  return (
    <Frame world="field" active="learner" title="C major scale" sub="Rep 3 of 5, step 2" aside={<Steps items={['Watch', 'Strings', 'Ghost', 'Blind']} current={2} label="Training stages" />}>
      <div className="dz-body">
        <ScoreScene learned={false} />
        <aside className="dz-panel" aria-label="Rep result">
          <h2 className="dz-panel__h">A clean rep, nearly</h2>
          <p className="dz-body-text">86 overall. Four fingers matched the expert; the ring finger pressed late. One more clean rep learns this step.</p>
          <dl className="dz-facts">
            <div>
              <dt>Clean reps</dt>
              <dd>2 of 3 needed</dd>
            </div>
            <div>
              <dt>Best so far</dt>
              <dd>88</dd>
            </div>
            <div>
              <dt>Streak</dt>
              <dd>4 days</dd>
            </div>
          </dl>
          <div className="dz-panel__foot">
            <Primary k="Space">Next rep</Primary>
            <button type="button" className="dz-link">
              Watch the expert again <Key>W</Key>
            </button>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

/** 4b. The step-learned state: the only place gold leaf appears, laid into the seal and the plaque rule. */
export function ScoreLearned() {
  return (
    <Frame world="field" active="learner" title="C major scale" sub="Step 2 of 4 learned" aside={<Steps items={['Watch', 'Strings', 'Ghost', 'Blind']} current={4} label="Training stages" />}>
      <div className="dz-body">
        <ScoreScene learned />
        <aside className="dz-panel dz-panel--learned" aria-label="Step learned">
          <h2 className="dz-panel__h">
            <span className="dz-gold" aria-hidden="true">
              <Tick size={22} />
            </span>
            Step 2 learned
          </h2>
          <p className="dz-body-text">Two blind reps at 93 and 90. The seal takes its first gold; the review comes back in three days to keep it.</p>
          <dl className="dz-facts">
            <div>
              <dt>Lesson 1</dt>
              <dd>2 of 4 steps learned</dd>
            </div>
            <div>
              <dt>Next review</dt>
              <dd>Monday</dd>
            </div>
          </dl>
          <div className="dz-panel__foot">
            <Primary k="Space">Next step</Primary>
            <button type="button" className="dz-link">
              Replay my best rep <Key>R</Key>
            </button>
          </div>
        </aside>
      </div>
    </Frame>
  );
}
