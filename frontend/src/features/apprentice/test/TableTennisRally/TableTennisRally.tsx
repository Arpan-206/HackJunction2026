import { useCallback, useEffect, useRef, useState } from 'react';
import { useGloveStream, type TestSpec } from '../../../../api';
import { Badge, Button, Card } from '../../../../components/ui';
import { useStreamClock } from '../../hooks/useStreamClock';
import { TestResult } from '../TestResult';
import { RallyGame, type PlayerId, type RallyPhase } from './rally';
import { RallyScene } from './RallyScene';
import { SwingTracker, type SwingReading } from './swing';

const SIM_BEAT_S = 1.5;
/** Fraction of the simulator beat at which the wrist snap is under way. */
const SIM_CONTACT = 0.615;
const KEY_SWING_S = 0.6;

interface Snapshot {
  phase: RallyPhase;
  points: Record<PlayerId, number>;
  rounds: Record<PlayerId, number>;
  round: number;
  rally: number;
  caption: string;
}

const EMPTY: Snapshot = { phase: 'serve', points: { a: 0, b: 0 }, rounds: { a: 0, b: 0 }, round: 1, rally: 0, caption: '' };

function snapshotOf(g: RallyGame): Snapshot {
  return { phase: g.phase, points: { ...g.points }, rounds: { ...g.rounds }, round: g.round, rally: g.rally, caption: g.caption };
}

/**
 * The table tennis test: a lapis table, a ball the game owns, and a bot or a second glove as the opponent. At the moment the
 * ball reaches a racket the game reads that glove (swing speed, racket face, grip) and decides whether the return is good,
 * into the net or long. Space swings for players without gloves.
 */
export function TableTennisRally({ spec }: { spec: TestSpec }) {
  const twoPlayer = spec.opponent === 'two_player';
  const gloves = useGloveStream(true);
  const clock = useStreamClock(gloves);
  const [stage, setStage] = useState<'intro' | 'playing' | 'result'>('intro');
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [cue, setCue] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const game = useRef<RallyGame>(new RallyGame({ twoPlayer, rounds: spec.rounds }));
  const trackers = useRef<Record<PlayerId, SwingTracker>>({ a: new SwingTracker(), b: new SwingTracker() });
  const keySwing = useRef(0);

  useEffect(() => {
    gloves.setMotion({ preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: SIM_BEAT_S * 1000 });
  }, [gloves, gloves.status]);

  useEffect(
    () =>
      gloves.onFrame((f) => {
        for (const h of f.hands) trackers.current[h.side === 'right' ? 'a' : 'b'].push(f.t, h);
      }),
    [gloves],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && stage === 'playing') {
        e.preventDefault();
        keySwing.current = performance.now() + KEY_SWING_S * 1000;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);

  const start = useCallback(() => {
    game.current = new RallyGame({
      twoPlayer,
      rounds: spec.rounds,
      streamNow: clock.now,
      scheduleContact: (after) => {
        if (!clock.simulated()) return null;
        const k = Math.ceil((after - SIM_CONTACT * SIM_BEAT_S) / SIM_BEAT_S);
        return k * SIM_BEAT_S + SIM_CONTACT * SIM_BEAT_S;
      },
    });
    setSnap(snapshotOf(game.current));
    setRunKey((k) => k + 1);
    setStage('playing');
  }, [clock, spec.rounds, twoPlayer]);

  useEffect(() => {
    if (stage !== 'playing') return;
    let last = performance.now();
    const read = (p: PlayerId): SwingReading | null => {
      if (p === 'a' && performance.now() < keySwing.current) return { swinging: true, peakSpeed: 6.5, faceAngle: 0.15, gripDeg: 200 };
      return trackers.current[p].read(clock.now());
    };
    const id = window.setInterval(() => {
      const now = performance.now();
      const g = game.current;
      const events = g.update((now - last) / 1000, read);
      last = now;
      const eta = g.eta();
      const wantCue = eta !== null && eta < 0.55 && (twoPlayer || g.incoming === 'a');
      setCue((c) => (c === wantCue ? c : wantCue));
      if (events.length) {
        setSnap(snapshotOf(g));
        if (events.some((e) => e.type === 'match')) {
          setStage('result');
        }
      }
    }, 16);
    return () => window.clearInterval(id);
  }, [stage, clock, twoPlayer, runKey]);

  const g = game.current;
  const left: PlayerId = twoPlayer ? 'b' : 'a';
  const right: PlayerId = twoPlayer ? 'a' : 'b';
  const leftName = twoPlayer ? 'Player 1 (left glove)' : 'You';
  const rightName = twoPlayer ? 'Player 2 (right glove)' : 'The bot';

  if (stage === 'result') {
    const youWon = g.winner === 'a';
    const mine = twoPlayer ? Math.max(g.totals.a, g.totals.b) : g.totals.a;
    return (
      <TestResult
        title={twoPlayer ? 'Two-player rally' : 'Rally against the bot'}
        score={`${g.totals[left]} : ${g.totals[right]}`}
        scoreLabel={`Points won, ${leftName} against ${rightName}`}
        verdict={twoPlayer ? 'win' : youWon ? 'win' : 'lose'}
        verdictText={twoPlayer ? `${g.name(g.winner ?? 'a')} wins the match` : youWon ? 'You win the match' : 'The bot wins the match'}
        bestMoment={g.best.text || (g.longestRally > 0 ? `A rally of ${g.longestRally} returns` : '')}
        details={<p className="note">Longest rally: {g.longestRally} returns. {twoPlayer ? `Winner took ${mine} points.` : `You won ${mine} points.`}</p>}
        onAgain={() => setStage('intro')}
      />
    );
  }

  return (
    <div className="ap-arena ap-arena--tt">
      {stage === 'playing' && (
      <div className="ap-board" role="status" aria-label="Scoreboard">
        <div className={`ap-board__side ${snap.points[left] > snap.points[right] ? 'ap-board__side--lead' : ''}`}>
          <span className="ap-board__name">{leftName}</span>
          <span className="ap-board__score">{snap.points[left]}</span>
          <span className="ap-board__pips" aria-label={`${snap.rounds[left]} rounds won`}>
            {Array.from({ length: snap.rounds[left] }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        </div>
        <div className="ap-board__mid">
          <span className="ap-kicker">
            Round {snap.round} of {spec.rounds}
          </span>
          <span className="ap-board__first">First to 5</span>
        </div>
        <div className={`ap-board__side ${snap.points[right] > snap.points[left] ? 'ap-board__side--lead' : ''}`}>
          <span className="ap-board__name">{rightName}</span>
          <span className="ap-board__score">{snap.points[right]}</span>
          <span className="ap-board__pips" aria-label={`${snap.rounds[right]} rounds won`}>
            {Array.from({ length: snap.rounds[right] }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        </div>
      </div>
      )}
      <div className="ap-arena__scene">
        <RallyScene key={runKey} game={g} gloves={gloves} twoPlayer={twoPlayer} />
        {stage === 'playing' && (
          <>
            {cue && <p className="ap-cue">SWING!</p>}
            {snap.phase === 'point' && snap.caption && (
              <p className="ap-replay" role="status">
                <span className="ap-kicker">Instant replay</span>
                {snap.caption}
              </p>
            )}
            {snap.phase === 'round' && <p className="ap-replay ap-replay--round">Round {snap.round} complete. Next round starts shortly.</p>}
            <p className="ap-rally" aria-live="off">
              Rally {snap.rally}
            </p>
          </>
        )}
        {stage === 'intro' && (
          <Card as="section" className="ap-intro" aria-label="How to play">
            <p className="ap-kicker">Test your skills</p>
            <h2>{twoPlayer ? 'Two-player rally' : 'Rally against the bot'}</h2>
            <ul className="ap-intro__rules">
              <li>First to 5 points wins a round. Best of {spec.rounds} rounds.</li>
              <li>Swing as the ball reaches your racket. The game reads your swing speed, racket face and grip at that instant.</li>
              <li>{twoPlayer ? 'Left glove is Player 1, right glove is Player 2, facing each other.' : 'Your right glove plays the near racket.'}</li>
              <li>No gloves? Press Space to swing.</li>
            </ul>
            <div className="ap-intro__foot">
              <Badge tone={gloves.status === 'open' ? 'ok' : 'neutral'}>{gloves.status === 'open' ? 'Gloves live' : 'Gloves not linked'}</Badge>
              <Button large onClick={start}>
                Start the rally
              </Button>
            </div>
          </Card>
        )}
      </div>
      <p className="note ap-arena__hint">The racket in the picture follows your wrist. Hold the face level for a clean return: tilted closed it finds the net, tilted open it goes long.</p>
    </div>
  );
}
