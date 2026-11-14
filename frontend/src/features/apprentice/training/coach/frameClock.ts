import type { GloveFrame } from '../../../../api/types';

/** A glove frame older than this (no newer one has arrived) means the stream has stopped. */
export const STALE_FRAME_MS = 300;

/**
 * Watches whether the glove stream is still flowing. The stream keeps its last frame after the socket drops, the source
 * changes or the simulator falls silent, so "a frame is there" does not mean "frames are arriving".
 */
export class FrameWatch {
  private last: GloveFrame | null = null;
  private at = Number.NEGATIVE_INFINITY;

  /** True when `frame` is new since the last call, or arrived less than STALE_FRAME_MS before `nowMs`. */
  fresh(frame: GloveFrame | null, nowMs: number): boolean {
    if (!frame) return false;
    if (frame !== this.last) {
      this.last = frame;
      this.at = nowMs;
      return true;
    }
    return nowMs - this.at < STALE_FRAME_MS;
  }
}

/**
 * Whether the reference clock follows the glove's own clock: only for a simulated glove that is still streaming, on a
 * periodic reference at full speed, so the ghost and the simulator share a beat. A stalled stream would otherwise pin the
 * expert's hand to the time of its last frame and the hand would stand still.
 */
export function lockedToGlove(frame: GloveFrame | null, fresh: boolean, periodic: boolean, rate: number): boolean {
  return fresh && frame?.source === 'simulator' && periodic && rate === 1;
}
