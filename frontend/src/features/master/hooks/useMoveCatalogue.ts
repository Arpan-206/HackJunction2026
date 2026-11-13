import { useMoves, type MoveKind } from '../../../api';
import { LOCAL_MOVES } from '../lib';

export interface MoveCatalogue {
  moves: MoveKind[];
  loading: boolean;
  /** True when the backend did not answer and a small local set is shown instead. */
  offline: boolean;
  errorMessage: string | null;
}

/** GET /api/moves with a local fallback so the studio still renders without a backend. */
export function useMoveCatalogue(): MoveCatalogue {
  const { data, loading, error } = useMoves();
  if (data) return { moves: data, loading: false, offline: false, errorMessage: null };
  if (error) return { moves: LOCAL_MOVES, loading: false, offline: true, errorMessage: error.message };
  return { moves: [], loading, offline: false, errorMessage: null };
}
