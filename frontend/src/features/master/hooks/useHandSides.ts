import { useEffect, useState } from 'react';
import type { GloveStreamHandle, Side } from '../../../api';

/**
 * Which hands the glove stream currently carries. Re-renders only when the set changes, never per frame.
 */
export function useHandSides(glove: GloveStreamHandle): Side[] {
  const { onFrame } = glove;
  const [sides, setSides] = useState<Side[]>([]);
  useEffect(() => {
    let key = '';
    return onFrame((f) => {
      const next = f.hands.map((h) => h.side).sort();
      const k = next.join(',');
      if (k !== key) {
        key = k;
        setSides(next);
      }
    });
  }, [onFrame]);
  return sides;
}
