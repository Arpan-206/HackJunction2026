import { useEffect } from 'react';
import type { GloveSource, GloveStreamHandle, MotionSpec } from '../../../api';

/**
 * When the simulator (not a real glove) feeds the stream, drives it with the move being recorded
 * so a demo without gloves still captures a meaningful take. Real gloves ignore the request.
 */
export function useSimulatorMotion(glove: GloveStreamHandle, source: GloveSource | null, motion: MotionSpec | null): void {
  const { setMotion, status } = glove;
  useEffect(() => {
    if (source === 'simulator' && motion && status === 'open') setMotion(motion);
  }, [source, motion, setMotion, status]);
}
