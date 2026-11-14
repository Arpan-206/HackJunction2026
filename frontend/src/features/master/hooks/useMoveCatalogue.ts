import { useMoves, type MoveKind } from '../../../api';
import { LOCAL_MOVES } from '../lib';

export interface MoveCatalogue {
  moves: MoveKind[];
  loading: boolean;
  /** True when the backend did not answer and a small local set is shown instead. */
  offline: boolean;
  errorMessage: string | null;
  /** Asks the backend again. */
  retry: () => void;
}

/** GET /api/moves with a local fallback so the studio still renders without a backend. */
export function useMoveCatalogue(): MoveCatalogue {
  const { data, loading, error, reload } = useMoves();
  if (data) return { moves: data, loading: false, offline: false, errorMessage: null, retry: reload };
  if (error) return { moves: LOCAL_MOVES, loading: false, offline: true, errorMessage: error.message, retry: reload };
  return { moves: [], loading, offline: false, errorMessage: null, retry: reload };
}
