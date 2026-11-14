import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import { PerspectiveCamera, View } from "@react-three/drei";
import type { PerspectiveCamera as PerspectiveCameraImpl } from "three";
import { useTheme } from "../theme";
import { PRESETS, Stage, type CameraPreset } from "./Stage";
import { StageColorsContext } from "./stageContext";

interface PreviewApi {
  /** Registers one mounted preview; returns the unregister function. */
  register: () => () => void;
}

const PreviewContext = createContext<PreviewApi | null>(null);

/**
 * Hosts ONE shared WebGL canvas that renders every small hand preview inside its own scissored view.
 * Browsers allow only a handful of live WebGL contexts, so each preview owning a canvas ends up grey; with this
 * host the whole page uses a single extra context. The canvas exists only while at least one preview is mounted,
 * and is rebuilt if the browser drops the context.
 */
export function PreviewHost({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [count, setCount] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const api = useMemo<PreviewApi>(
    () => ({
      register: () => {
        setCount((c) => c + 1);
        return () => setCount((c) => c - 1);
      },
    }),
    [],
  );
  return (
    <PreviewContext.Provider value={api}>
      <div ref={host} className={className} style={{ position: "relative" }}>
        {children}
        {count > 0 && (
          <div className="preview-layer" aria-hidden="true">
            <Canvas
              key={epoch}
              flat
              dpr={[1, 1.5]}
              eventSource={host as React.MutableRefObject<HTMLElement>}
              gl={{ antialias: true, alpha: true, stencil: true }}
              style={{ pointerEvents: "none" }}
              onCreated={({ gl }) => {
                const el = gl.domElement;
                el.addEventListener("webglcontextlost", (e) => {
                  e.preventDefault();
                  window.setTimeout(() => setEpoch((n) => n + 1), 250);
                });
              }}
            >
              <View.Port />
            </Canvas>
          </div>
        )}
      </div>
    </PreviewContext.Provider>
  );
}

function Rig({
  position,
  target,
}: {
  position: [number, number, number];
  target: [number, number, number];
}) {
  const cam = useRef<PerspectiveCameraImpl>(null);
  useLayoutEffect(() => {
    cam.current?.lookAt(...target);
  }, [target]);
  return (
    <PerspectiveCamera
      ref={cam}
      makeDefault
      position={position}
      fov={30}
      near={0.1}
      far={80}
    />
  );
}

interface HandPreviewProps {
  className?: string;
  preset?: CameraPreset;
  /** Accessible description of the preview. */
  label: string;
  /** Scene contents, typically a <Hand> and optional prop. */
  children: ReactNode;
  /** Draws the walnut bench and plaster wall (low quality: no model props) instead of the plain carta azzurra. */
  decor?: boolean;
}

/**
 * A small hand preview drawn by the shared PreviewHost canvas. Give it a size with `className`. Falls back to an
 * empty tile when no host is mounted.
 */
export function HandPreview({
  className,
  preset = "closeup",
  label,
  children,
  decor = false,
}: HandPreviewProps) {
  const api = useContext(PreviewContext);
  const { stage: colors } = useTheme();
  const p = PRESETS[preset];
  const register = api?.register;
  useEffect(() => register?.(), [register]);
  const target = useMemo(() => p.target, [p]);
  if (!api) return <div className={className} role="img" aria-label={label} />;
  return (
    <div className={className} role="img" aria-label={label}>
      <View style={{ width: "100%", height: "100%" }}>
        <StageColorsContext.Provider value={colors}>
          <Rig position={p.position} target={target} />
          <Stage
            groundY={p.groundY}
            showGrid={false}
            circleRadius={p.circle}
            circleCenter={p.circleCenter}
            shadowSize={p.shadow}
            controls="none"
            target={p.target}
            cameraPosition={p.position}
            decor={decor}
            quality="low"
          />
          <Suspense fallback={null}>{children}</Suspense>
        </StageColorsContext.Provider>
      </View>
    </div>
  );
}
