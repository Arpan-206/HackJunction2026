import { useEffect, useState } from 'react';
import type { LoopClock } from '../clock';
import { loadTake, type TakeName, type TourTake } from '../data';

/** A bundled take, null until its chunk has loaded. */
export function useTake(name: TakeName): TourTake | null {
  const [take, setTake] = useState<TourTake | null>(null);
  useEffect(() => {
    let alive = true;
    void loadTake(name).then((t) => alive && setTake(t));
    return () => {
      alive = false;
    };
  }, [name]);
  return take;
}

export function PlayButton({ clock }: { clock: LoopClock }) {
  return (
    <button type="button" className="btn btn--secondary tour-play" onClick={clock.toggle} aria-pressed={clock.playing}>
      {clock.playing ? 'Pause' : 'Play'}
    </button>
  );
}
