import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Calibration, type Side, type WearerCalibration } from '../../../api';
import { GUEST_POSES, HOLD_S, READY_S } from './demoLogic';

export type GuestPhase = 'idle' | 'ready' | 'hold' | 'saving' | 'done';

export interface GuestCalibrationState {
  phase: GuestPhase;
  /** Index into GUEST_POSES while running. */
  pose: number;
  /** Whole seconds left in the current ready or hold phase. */
  left: number;
  /** Seconds done of the whole sequence, for the progress bar. */
  elapsed: number;
  /** Plain notes for the operator when a save failed; the visitor goes on regardless. */
  notes: string[];
}

export interface GuestCalibrationDeps {
  wearer: string;
  sides: Side[];
  /** Sends the core's `calibrate` (yaw zero, and a reload of the newest flat and fist); absent when no core is up. */
  coreCalibrate?: () => Promise<unknown>;
}

const IDLE: GuestCalibrationState = { phase: 'idle', pose: 0, left: 0, elapsed: 0, notes: [] };

const why = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

/**
 * The 20 second guest calibration: flat hand, fist, thumb folded, each with a short get-ready count and a held capture.
 *
 * Flat: the backend's neutral pose for this guest (offsets and heading zero), the flat range per hand, and the core's
 * `calibrate` (it zeroes the heading over the next second). Fist: the fist range. Thumb folded: the additive `thumb`
 * phase, and a second core `calibrate`, now that the guest's flat and fist are the newest on disk, so the core reloads
 * them (core/calibration.py with no wearer set takes the newest per side). Last, the neutral record is linked to the
 * range ids. A failed save never stops the visitor: it is noted for the operator and the hold still runs its time.
 */
export function useGuestCalibration() {
  const [state, setState] = useState<GuestCalibrationState>(IDLE);
  const run = useRef(0);

  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  const reset = useCallback(() => {
    run.current += 1;
    setState(IDLE);
  }, []);

  const start = useCallback(async (deps: GuestCalibrationDeps) => {
    const me = ++run.current;
    const live = () => run.current === me;
    const notes: string[] = [];
    const note = (what: string, e: unknown) => notes.push(`${what}: ${why(e)}`);
    let elapsed = 0;
    const patch = (p: Partial<GuestCalibrationState>) => {
      if (live()) setState((s) => ({ ...s, ...p, elapsed, notes: [...notes] }));
    };
    const countDown = async (phase: 'ready' | 'hold', pose: number, seconds: number) => {
      for (let left = seconds; left > 0; left--) {
        patch({ phase, pose, left });
        await sleep(1000);
        if (!live()) return false;
        elapsed += 1;
      }
      return true;
    };

    let neutral: WearerCalibration | null = null;
    const ranges: Partial<Record<Side, Calibration>> = {};
    const captureRange = (phase: (typeof GUEST_POSES)[number]['id']) =>
      deps.sides.map((side) =>
        api
          .calibrate({ side, phase, duration_s: HOLD_S })
          .then((c) => {
            ranges[side] = c;
          })
          .catch((e) => note(`${side} hand, ${phase}`, e)),
      );

    for (let i = 0; i < GUEST_POSES.length; i++) {
      if (!(await countDown('ready', i, READY_S))) return;
      const id = GUEST_POSES[i].id;
      const saves: Promise<unknown>[] = captureRange(id);
      if (id === 'flat') {
        saves.push(
          api
            .captureNeutral({ wearer: deps.wearer, duration_s: HOLD_S })
            .then((c) => {
              neutral = c;
            })
            .catch((e) => note('Start pose', e)),
        );
      }
      if ((id === 'flat' || id === 'thumb') && deps.coreCalibrate) saves.push(deps.coreCalibrate().catch((e) => note('Glove engine calibrate', e)));
      const held = countDown('hold', i, HOLD_S);
      await Promise.all([held, ...saves]);
      if (!live()) return;
    }

    patch({ phase: 'saving', left: 0 });
    const ids = Object.fromEntries(Object.entries(ranges).map(([s, c]) => [s, (c as Calibration).id])) as Partial<Record<Side, string>>;
    const n = neutral as WearerCalibration | null;
    if (n && Object.keys(ids).length) {
      await api.finishWearerCalibration(n.id, { range_calibration_ids: ids, verified: false }).catch((e) => note('Linking the calibration', e));
    }
    patch({ phase: 'done', left: 0 });
  }, []);

  return { ...state, start, reset };
}

function sleep(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}
