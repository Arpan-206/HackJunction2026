import { Quaternion } from 'three';
import type { Finger, HandFrame, JointTriple } from '../api/types';
import { FINGER_ORDER } from './anatomy';

/** Render-side smoothing. The backend does the heavy jitter filtering; this only hides the 60 Hz stepping. */
export interface SmoothingConfig {
  /** Time constant in seconds for joint angles. 0 disables smoothing. Default 0.045. */
  tau?: number;
  /** Time constant in seconds for the wrist orientation. Defaults to tau * 1.3. */
  quatTau?: number;
}

export const DEFAULT_SMOOTHING: Required<SmoothingConfig> = { tau: 0.045, quatTau: 0.06 };

const N_FLEX = 15;
const N_SPREAD = 5;

/** Exponentially smoothed hand pose: 15 flexion angles, 5 spreads and the wrist quaternion. */
export class HandSmoother {
  readonly flex = new Float32Array(N_FLEX);
  readonly spread = new Float32Array(N_SPREAD);
  readonly quat = new Quaternion();
  readonly pos: [number, number, number] = [0, 0, 0];
  private primed = false;
  private readonly target = new Quaternion();

  /** Moves the smoothed state towards `frame` by dt seconds; the first call snaps to the frame. */
  step(frame: HandFrame, dt: number, cfg: SmoothingConfig | number | false = {}): void {
    const c = typeof cfg === 'number' ? { tau: cfg, quatTau: cfg * 1.3 } : cfg === false ? { tau: 0, quatTau: 0 } : cfg;
    const tau = c.tau ?? DEFAULT_SMOOTHING.tau;
    const quatTau = c.quatTau ?? (c.tau !== undefined ? c.tau * 1.3 : DEFAULT_SMOOTHING.quatTau);
    const a = !this.primed || tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    const aq = !this.primed || quatTau <= 0 ? 1 : 1 - Math.exp(-dt / quatTau);

    for (let i = 0; i < 5; i++) {
      const name: Finger = FINGER_ORDER[i];
      const f: JointTriple = frame.flexion[name];
      for (let j = 0; j < 3; j++) this.flex[i * 3 + j] += ((f ? f[j] : 0) - this.flex[i * 3 + j]) * a;
      const sp = frame.spread ? frame.spread[name] ?? 0 : 0;
      this.spread[i] += (sp - this.spread[i]) * a;
    }

    const q = frame.wrist_quat;
    this.target.set(q[0], q[1], q[2], q[3]).normalize();
    if (this.target.dot(this.quat) < 0 && this.primed) this.target.set(-this.target.x, -this.target.y, -this.target.z, -this.target.w);
    if (!this.primed) this.quat.copy(this.target);
    else this.quat.slerp(this.target, aq);

    const p = frame.wrist_pos;
    if (p) for (let k = 0; k < 3; k++) this.pos[k] += (p[k] - this.pos[k]) * (this.primed ? a : 1);
    this.primed = true;
  }

  /** Forget history so the next step snaps. */
  reset(): void {
    this.primed = false;
  }
}
