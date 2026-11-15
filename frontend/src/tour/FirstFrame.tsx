import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

/**
 * Put beside a hand inside the canvas: it mounts only when the hand has loaded (they share one Suspense), and after two
 * rendered frames it calls onLive once and stamps the time on the page (`data-stage-live`, ms since navigation start),
 * which the browser check reads as "3D stage live".
 */
export function FirstFrame({ onLive }: { onLive: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current !== 2) return;
    if (!document.body.dataset.stageLive) document.body.dataset.stageLive = String(Math.round(performance.now()));
    onLive();
  });
  return null;
}
