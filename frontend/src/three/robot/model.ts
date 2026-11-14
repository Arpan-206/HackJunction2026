import { useEffect, useState } from 'react';
import type { Side } from '../../api/types';
import type { RobotModels } from './kinematics';
import { parseUrdf } from './urdf';

/** Where the twin's URDFs are served: a copy of the root models/robots/dex3_1 (see the LICENSE.md there). */
export const ROBOT_URDF = { left: '/models/robots/dex3_1/dex3_1_l.urdf', right: '/models/robots/dex3_1/dex3_1_r.urdf' } as Record<Side, string>;

let pending: Promise<RobotModels> | null = null;
let loaded: RobotModels | null = null;

/** Fetches and parses both Dex3-1 URDFs once per page. A failed load is forgotten so the next call retries. */
export function loadRobotModels(): Promise<RobotModels> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    const one = (side: Side) =>
      fetch(ROBOT_URDF[side]).then((r) => {
        if (!r.ok) throw new Error(`${ROBOT_URDF[side]}: HTTP ${r.status}`);
        return r.text();
      });
    pending = Promise.all([one('left'), one('right')])
      .then(([l, r]) => {
        loaded = { left: parseUrdf(l), right: parseUrdf(r) };
        return loaded;
      })
      .catch((e: unknown) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}

/** Both robot models, or null while loading; `error` says why when the files could not be read. */
export function useRobotModels(): { models: RobotModels | null; error: string | null } {
  const [models, setModels] = useState<RobotModels | null>(loaded);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (models) return;
    let live = true;
    loadRobotModels()
      .then((m) => live && setModels(m))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'the robot model could not be read'));
    return () => {
      live = false;
    };
  }, [models]);
  return { models, error };
}
