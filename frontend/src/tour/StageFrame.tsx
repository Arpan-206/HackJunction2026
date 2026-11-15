import { Component, Suspense, type ReactNode } from 'react';

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
      {still && <img src={still} alt="" loading="lazy" />}
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

/** The 3D stage box of a stop: a fixed aspect that fits a phone, a fallback without WebGL, and a guard for render errors. */
export function StageFrame({ children, still, text, tall = false }: { children: ReactNode; still?: string; text: string; tall?: boolean }) {
  const fallback = <StageFallback still={still} text={text} />;
  return (
    <div className={`tour-stage ${tall ? 'tour-stage--tall' : ''}`}>
      {hasWebGL() ? (
        <Boundary fallback={fallback}>
          <Suspense fallback={<p className="tour-stage__loading">Loading the 3D stage...</p>}>{children}</Suspense>
        </Boundary>
      ) : (
        fallback
      )}
    </div>
  );
}
