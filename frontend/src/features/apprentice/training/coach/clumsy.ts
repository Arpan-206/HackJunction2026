import { FINGERS, type Finger, type HandFrame, type JointTriple } from '../../../../api/types';

const DEG = Math.PI / 180;

/** Settings for the dev-only "clumsy apprentice" simulation. */
export interface ClumsyConfig {
  finger: Finger;
  lagS: number;
  undercurlDeg: number;
  noiseDeg: number;
}

export const DEFAULT_CLUMSY: ClumsyConfig = { finger: 'ring', lagS: 0.3, undercurlDeg: 25, noiseDeg: 2 };

/**
 * Makes live frames sloppy for demonstrations: one finger lags and under-curls, every finger gets a little noise.
 * Keeps a short history of frames so the lag is real.
 */
export class ClumsySim {
  private readonly history: { at: number; hand: HandFrame }[] = [];

  constructor(private readonly cfg: ClumsyConfig = DEFAULT_CLUMSY) {}

  /** Returns the perturbed version of `hand`, given the wall-clock time in seconds. */
  apply(hand: HandFrame, nowS: number): HandFrame {
    this.history.push({ at: nowS, hand });
    while (this.history.length > 2 && this.history[0].at < nowS - this.cfg.lagS - 0.5) this.history.shift();
    let lagged = hand;
    for (const h of this.history) {
      if (h.at <= nowS - this.cfg.lagS) lagged = h.hand;
      else break;
    }
    const flexion = {} as Record<Finger, JointTriple>;
    FINGERS.forEach((f, i) => {
      const src = f === this.cfg.finger ? lagged.flexion[f] : hand.flexion[f];
      const under = f === this.cfg.finger ? (this.cfg.undercurlDeg * DEG) / 3 : 0;
      const noise = Math.sin(nowS * (9 + i * 2.3) + i) * this.cfg.noiseDeg * DEG * 0.4;
      flexion[f] = [src[0] - under + noise, src[1] - under + noise, src[2] - under + noise];
    });
    return { ...hand, flexion };
  }

  /** Drops the stored history, for example when the simulation is switched off. */
  reset(): void {
    this.history.length = 0;
  }
}
