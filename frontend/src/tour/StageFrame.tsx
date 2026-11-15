import { Component, Suspense, useState, type ReactNode } from 'react';

/** Whether this browser can draw WebGL at all. Checked once. */
let webgl: boolean | null = null;
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webgl = false;
  }
  return webgl;
}

/** What the visitor sees when the 3D stage cannot draw: a still picture (when the stop has one) and the text. */
export function StageFallback({ still, text }: { still?: string; text: string }) {
  return (
    <div className="tour-stage__fallback" role="img" aria-label={text}>
      {still && <img src={still} alt="" />}
      <p>{text}</p>
      <p className="tour-small">Your browser could not start 3D drawing, so this stop shows a still and the text.</p>
    </div>
  );
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface StageFrameProps {
  children: ReactNode;
  /** A still of this stage (a screenshot from the browser check), shown at once and until `live`. */
  poster?: string;
  /** The live 3D stage has drawn: the poster fades out. Without a poster this is ignored. */
  live?: boolean;
  text: string;
  tall?: boolean;
}

/**
 * The 3D stage box of a stop: a fixed size that fits a phone, the poster in the same box (so swapping in the live
 * stage moves nothing), a fallback without WebGL, and a guard for render errors.
 */
export function StageFrame({ children, poster, live = false, text, tall = false }: StageFrameProps) {
  const [posterOk, setPosterOk] = useState(true);
  const fallback = <StageFallback still={posterOk ? poster : undefined} text={text} />;
  const showPoster = !!poster && posterOk && !live;
  return (
    <div className={`tour-stage ${tall ? 'tour-stage--tall' : ''}`}>
      {hasWebGL() ? (
        <Boundary fallback={fallback}>
          <Suspense fallback={poster ? null : <p className="tour-stage__loading">Loading the 3D stage...</p>}>{children}</Suspense>
        </Boundary>
      ) : (
        fallback
      )}
      {showPoster && hasWebGL() && (
        <img className="tour-stage__poster" src={poster} alt={text} onError={() => setPosterOk(false)} />
      )}
    </div>
  );
}
