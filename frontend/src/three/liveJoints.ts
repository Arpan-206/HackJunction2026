import { wantCoreJoints } from '../api/coreJoints';
import type { GloveFrame, HandFrame, Side } from '../api/types';
import { FINGER_ORDER } from './anatomy';

/** Mean flexion difference (radians) under which a GloveFrame hand counts as the core skeleton's own reading. */
const MATCH_RAD = 0.12;
/** A core skeleton older than this (ms) is stale. */
const FRESH_MS = 300;
/** After a match, how long (ms) the skeleton keeps driving the hand: the two sockets tick apart, so a fast move can differ. */
const HOLD_MS = 600;

/**
 * Chooses, per live hand, whether the glove core's full skeleton may draw it (api/coreJoints.ts). Only when the hand's
 * own GloveFrame came from that core: the stream is not the simulator, and its flexion matches the angles the core
 * derives from the skeleton. A backend on its simulator, a replay of another take or a different wearer never match, so
 * they keep the angle pose and nothing else is ever shown.
 */
export class LiveJointsGate {
  private lastMatch = -Infinity;

  /** The skeleton to draw `hand` with, or null to draw it from its angles. Call once per render frame. */
  pick(glove: GloveFrame | null | undefined, hand: HandFrame | null, side: Side): Float32Array | null {
    if (!glove || !hand || glove.source === 'simulator') return null;
    const core = wantCoreJoints(side);
    const now = performance.now();
    if (!core || now - core.at > FRESH_MS) return null;
    let diff = 0;
    for (let f = 0; f < 5; f++) {
      const t = hand.flexion[FINGER_ORDER[f]];
      if (!t) return null;
      for (let k = 0; k < 3; k++) diff += Math.abs((t[k] ?? 0) - core.flex[f * 3 + k]);
    }
    if (diff / 15 < MATCH_RAD) this.lastMatch = now;
    return now - this.lastMatch < HOLD_MS ? core.joints : null;
  }
}
