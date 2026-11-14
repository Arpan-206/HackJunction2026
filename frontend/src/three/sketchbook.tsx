import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, Color, DirectionalLight, MeshBasicMaterial, Object3D, ShadowMaterial, SRGBColorSpace, Vector2, type Material, type Mesh, type Texture } from 'three';
import type { StageColors } from '../theme/themes';
import { getParchmentTexture } from './parchment';

/**
 * The sketchbook stage: a sheet of parchment lying on the page, ruled with a fine ink grid inside a double border, and
 * the hands' cast shadows drawn on it as diagonal iron-gall hatching instead of a grey blur. The page behind is the
 * same aged paper, so the hand reads as a study drawn in a Renaissance notebook.
 *
 * Cost per canvas: one 1024 shadow map of the opaque meshes (the hands and props), two flat planes and a static
 * background texture. Canvases without shadow maps (the still renderer) get a pre-hatched blob instead.
 */

/** World size of one grid cell on the sheet; every fourth line is a major line. */
const GRID_CELL = 0.2;
/** Spacing of the shadow hatching in world units (about 12 px on a full-size stage, 5 px on a card). */
const HATCH_SPACING = 0.06;

export interface SheetRect {
  cx: number;
  cz: number;
  w: number;
  d: number;
}

/**
 * The sheet's material: the parchment texture with the ink grid, the double ruled border and the cut edge drawn in
 * the shader, so the lines stay one pixel fine at any distance instead of blurring in a texture. Unlit on purpose: the
 * paper keeps its exact tone under every light.
 */
function createSheetMaterial(map: Texture, stage: StageColors, sheet: SheetRect, grid: boolean): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ map });
  const uniforms = {
    uSheetCenter: { value: new Vector2(sheet.cx, sheet.cz) },
    uSheetSize: { value: new Vector2(sheet.w, sheet.d) },
    uInk: { value: new Color(stage.grid) },
    uEdgeTone: { value: new Color(stage.background) },
    uFalloff: { value: stage.paperFalloff },
    uGridOpacity: { value: grid ? stage.gridOpacity : 0 },
    uCell: { value: GRID_CELL },
    uBorder: { value: Math.min(sheet.w, sheet.d) * 0.035 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSkWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSkWorld;
uniform vec2 uSheetCenter;
uniform vec2 uSheetSize;
uniform vec3 uInk;
uniform vec3 uEdgeTone;
uniform float uFalloff;
uniform float uGridOpacity;
uniform float uCell;
uniform float uBorder;
float skLine(float dist, float fw, float width) {
  return 1.0 - smoothstep(width * 0.5 * fw, (width * 0.5 + 1.0) * fw, dist);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec2 p = vSkWorld.xz;
  vec2 rel = (p - uSheetCenter) / (uSheetSize * 0.5);
  float r = length(rel * vec2(0.85, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uEdgeTone, uFalloff * smoothstep(0.25, 1.3, r));

  vec2 g = p / uCell;
  vec2 fw = max(fwidth(g), vec2(1e-4));
  vec2 gd = abs(fract(g - 0.5) - 0.5) / fw;
  float minor = 1.0 - min(min(gd.x, gd.y), 1.0);
  vec2 G = g * 0.25;
  vec2 FW = max(fwidth(G), vec2(1e-4));
  vec2 GD = abs(fract(G - 0.5) - 0.5) / (FW * 1.5);
  float major = 1.0 - min(min(GD.x, GD.y), 1.0);
  float dense = max(fw.x, fw.y);
  float gridA = max(minor * 0.3 * (1.0 - smoothstep(0.12, 0.35, dense)), major * (1.0 - smoothstep(0.05, 0.12, dense))) * uGridOpacity;

  vec2 e = uSheetSize * 0.5 - abs(p - uSheetCenter);
  float d = min(e.x, e.y);
  float fd = max(fwidth(d), 1e-5);
  float gap = uBorder * 0.28;
  float inside = smoothstep(0.0, 2.0 * fd, d - uBorder - gap);
  float outer = skLine(abs(d - uBorder), fd, 1.0);
  float inner = skLine(abs(d - uBorder - gap), fd, 0.6);
  float cut = skLine(d, fd, 1.0);
  float ink = max(gridA * inside, max(max(outer * 0.42, inner * 0.28), cut * 0.38));
  diffuseColor.rgb = mix(diffuseColor.rgb, uInk, ink);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'sketch-sheet-v1';
  return mat;
}

/**
 * Shadow catcher whose received shadow is drawn as diagonal ink strokes. The strokes are fixed to the paper (world
 * space), so they stay put when the camera orbits, thin out in the penumbra like a pen lifting, and melt into an even
 * tone where they would be too dense to resolve.
 */
export function createInkShadowMaterial(ink: string, opacity: number, spacing = HATCH_SPACING): ShadowMaterial {
  const mat = new ShadowMaterial({ color: new Color(ink), opacity, transparent: true, depthWrite: false });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHatchSpacing = { value: spacing };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInkWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvInkWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uHatchSpacing;\nvarying vec3 vInkWorld;\nvoid main() {')
      .replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        `float sm = 1.0 - getShadowMask();
  vec2 p = vInkWorld.xz;
  float u = (p.x + p.y) / uHatchSpacing + 0.12 * sin(p.x * 9.0 - p.y * 5.0);
  float fu = max(fwidth(u), 1e-4);
  float halfW = mix(0.04, 0.15, smoothstep(0.08, 0.85, sm));
  float dist = abs(fract(u) - 0.5);
  float stroke = 1.0 - smoothstep(halfW - fu * 0.5, halfW + fu * 0.5, dist);
  stroke = mix(stroke, 1.3 * halfW, smoothstep(0.42, 0.8, fu));
  gl_FragColor = vec4( color, opacity * stroke * smoothstep(0.04, 0.3, sm) );`,
      );
  };
  mat.customProgramCacheKey = () => 'sketch-ink-shadow-v1';
  return mat;
}

const poolCache = new Map<string, CanvasTexture>();

/**
 * The page behind the sheet on a dark theme: no paper fibres (they read as dust in the dark), just the warm pool of a
 * candle fading to the room's shadow at the edges.
 */
function candlePool(tone: string): CanvasTexture {
  let t = poolCache.get(tone);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, 512, 512);
  const glow = new Color(tone).lerp(new Color('#C08A4A'), 0.22);
  const shade = new Color(tone).multiplyScalar(0.45);
  const g = ctx.createRadialGradient(256, 330, 20, 256, 300, 380);
  g.addColorStop(0, `#${glow.getHexString()}`);
  g.addColorStop(0.55, tone);
  g.addColorStop(1, `#${shade.getHexString()}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  poolCache.set(tone, t);
  return t;
}

const isDark = (css: string) => {
  const c = new Color(css);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.12;
};

const blobCache = new Map<string, CanvasTexture>();

/** An oval of diagonal ink strokes fading at its rim: the shadow for canvases without shadow maps. */
function hatchedBlob(ink: string): CanvasTexture {
  let t = blobCache.get(ink);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  for (let k = -256; k < 512; k += 9) {
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(k, 256);
    ctx.lineTo(k + 256, 0);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 124);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  blobCache.set(ink, t);
  return t;
}

/**
 * Every opaque mesh in the scene casts a shadow (re-checked a few times a second, so hands and props mounted later
 * join in). Nothing is switched to receive: the hands keep their own shading, only the paper's catcher shows shadows.
 * Translucent meshes (ghosts, cues) and anything marked userData.noCast stay out.
 */
function ShadowCasters() {
  const scene = useThree((s) => s.scene);
  const tick = useRef(0);
  useFrame(() => {
    if (tick.current++ % 20 !== 0) return;
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m.userData.noCast === true) return;
      const mat = m.material as Material | Material[];
      const clear = Array.isArray(mat) ? false : mat.transparent || !mat.colorWrite;
      m.castShadow = !clear;
    });
  });
  return null;
}

/** The directional key light that throws the hands' shadows onto the sheet, aimed at the sheet's centre. */
function KeyShadowLight({ stage, sheet, groundY, cast }: { stage: StageColors; sheet: SheetRect; groundY: number; cast: boolean }) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const span = Math.max(sheet.w, sheet.d) * 0.62;
  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    target.position.set(sheet.cx, groundY, sheet.cz);
    target.updateMatrixWorld();
    l.target = target;
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.bias = -0.0006;
    l.shadow.normalBias = 0.02;
    const cam = l.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 0.5;
    cam.far = 14;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }, [target, sheet.cx, sheet.cz, groundY, span]);
  return (
    <>
      <primitive object={target} />
      {/* Same direction as the stage's old key light, (-2, 4, 3) from the target, so the hands are lit as before. */}
      <directionalLight ref={light} position={[sheet.cx - 2, groundY + 4.55, sheet.cz + 3]} intensity={1.5} color={stage.keyLight} castShadow={cast} />
    </>
  );
}

export interface SketchbookProps {
  stage: StageColors;
  groundY: number;
  sheet: SheetRect;
  grid?: boolean;
  /** Draw the hands' shadows (hatched). */
  shadow?: boolean;
  /** Centre and size of the fallback hatched blob, for canvases without shadow maps. */
  blobCenter?: readonly [number, number];
  blobSize?: readonly [number, number];
}

/** The page, the sheet, the key light and the hatched shadows. Replaces the old bench and plaster wall. */
export function Sketchbook({ stage, groundY, sheet, grid = true, shadow = true, blobCenter, blobSize = [2.4, 2.6] }: SketchbookProps) {
  const shadowsOn = useThree((s) => s.gl.shadowMap.enabled);
  const scene = useThree((s) => s.scene);
  const page = useMemo(() => (isDark(stage.background) ? candlePool(stage.background) : getParchmentTexture({ width: 1024, height: 1024, tone: stage.background, seed: 5, vignette: true })), [stage.background]);
  const paper = useMemo(() => getParchmentTexture({ width: 1024, height: 768, tone: stage.paper, seed: 11, vignette: false }), [stage.paper]);
  const sheetMat = useMemo(() => createSheetMaterial(paper, stage, sheet, grid), [paper, stage, sheet, grid]);
  const inkShadow = useMemo(() => createInkShadowMaterial(stage.hatch, stage.hatchOpacity), [stage.hatch, stage.hatchOpacity]);
  const blobMat = useMemo(() => new MeshBasicMaterial({ map: hatchedBlob(stage.hatch), transparent: true, opacity: stage.hatchOpacity * 0.8, depthWrite: false }), [stage.hatch, stage.hatchOpacity]);
  // Set imperatively rather than with attach: the still renderer swaps scenes in one root, and attach's restore on
  // unmount could run after the next scene's attach and clear the page to black.
  useLayoutEffect(() => {
    scene.background = page;
    return () => {
      if (scene.background === page) scene.background = null;
    };
  }, [scene, page]);
  useEffect(
    () => () => {
      sheetMat.dispose();
      inkShadow.dispose();
      blobMat.dispose();
    },
    [sheetMat, inkShadow, blobMat],
  );
  const live = shadow && shadowsOn;
  const bc = blobCenter ?? [sheet.cx, sheet.cz];
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sheet.cx, groundY, sheet.cz]} material={sheetMat} userData={{ noCast: true }}>
        <planeGeometry args={[sheet.w, sheet.d]} />
      </mesh>
      <KeyShadowLight stage={stage} sheet={sheet} groundY={groundY} cast={live} />
      {live && (
        <>
          <ShadowCasters />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sheet.cx, groundY + 0.003, sheet.cz]} material={inkShadow} receiveShadow renderOrder={1} userData={{ noCast: true, receive: true }}>
            <planeGeometry args={[sheet.w, sheet.d]} />
          </mesh>
        </>
      )}
      {shadow && !shadowsOn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bc[0], groundY + 0.004, bc[1] - 0.05]} material={blobMat} userData={{ noCast: true }}>
          <planeGeometry args={[blobSize[0], blobSize[1]]} />
        </mesh>
      )}
    </>
  );
}
