import {
  Color,
  DataTexture,
  LinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RGBAFormat,
  RepeatWrapping,
  LessEqualDepth,
  SRGBColorSpace,
  BackSide,
  Texture,
  TextureLoader,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Finger } from '../api/types';
import type { StageColors } from '../theme/themes';
import { FINGER_ORDER } from './anatomy';
import { withHatching } from './sketch';

/**
 * How a hand is drawn. chalk: master, wood: apprentice, ghost: translucent overlay, shadow: dark guidance,
 * sketch: the expert's codex hand, lit toon shading with iron-gall hatching and a heavier ink outline.
 */
export type HandStyle = 'chalk' | 'wood' | 'ghost' | 'shadow' | 'sketch';

let gradient: DataTexture | null = null;

/** Three-band toon ramp shared by every toon material. */
export function toonGradient(): DataTexture {
  if (!gradient) {
    const data = new Uint8Array([96, 96, 96, 255, 178, 178, 178, 255, 255, 255, 255, 255]);
    gradient = new DataTexture(data, 3, 1, RGBAFormat);
    gradient.minFilter = NearestFilter;
    gradient.magFilter = NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

let handRamp: DataTexture | null = null;

/**
 * The hands' own light ramp: a few soft steps instead of the props' three hard bands, so the back of a hand keeps the
 * relief of its knuckles and tendons while still reading as chalk rather than skin.
 */
export function handGradient(): DataTexture {
  if (!handRamp) {
    const steps = HAND_RAMP;
    const data = new Uint8Array(steps.length * 4);
    steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
    handRamp = new DataTexture(data, steps.length, 1, RGBAFormat);
    handRamp.minFilter = LinearFilter;
    handRamp.magFilter = LinearFilter;
    handRamp.needsUpdate = true;
  }
  return handRamp;
}
const HAND_RAMP = [80, 112, 158, 198, 224, 238];

export interface WoodTextures {
  color: Texture;
  normal: Texture;
  roughness: Texture;
}

let wood: WoodTextures | null = null;

/** Lazily loads the CC0 ambientCG Wood049 set from /textures/wood (see SOURCE.md there). Textures pop in when ready. */
export function getWoodTextures(): WoodTextures {
  if (wood) return wood;
  const loader = new TextureLoader();
  const load = (file: string, srgb: boolean): Texture => {
    const t = loader.load(`/textures/wood/${file}`);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.rotation = Math.PI / 2;
    t.center.set(0.5, 0.5);
    t.repeat.set(0.55, 1.6);
    t.anisotropy = 8;
    t.minFilter = LinearFilter;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  wood = { color: load('color.jpg', true), normal: load('normal.jpg', false), roughness: load('roughness.jpg', false) };
  return wood;
}


/**
 * Adds a shader patch on top of whatever onBeforeCompile a material already has (the hatching, say), and extends its
 * program cache key so differently patched materials never share a program.
 */
function patchShader<M extends Material>(mat: M, key: string, patch: (shader: WebGLProgramParametersWithUniforms) => void): M {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    patch(shader);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|${key}`;
  return mat;
}

const TINT_VERT_HEAD = /* glsl */ `
attribute vec4 aFingerA;
attribute float aFingerB;
attribute float aCavity;
uniform vec3 uFingerTint[5];
uniform float uFingerOn[5];
varying vec4 vFingerTint;
varying float vCavity;
`;

const TINT_VERT_BODY = /* glsl */ `
{
  float w0 = aFingerA.x * uFingerOn[0];
  float w1 = aFingerA.y * uFingerOn[1];
  float w2 = aFingerA.z * uFingerOn[2];
  float w3 = aFingerA.w * uFingerOn[3];
  float w4 = aFingerB * uFingerOn[4];
  float s = w0 + w1 + w2 + w3 + w4;
  vec3 c = uFingerTint[0] * w0 + uFingerTint[1] * w1 + uFingerTint[2] * w2 + uFingerTint[3] * w3 + uFingerTint[4] * w4;
  vFingerTint = vec4(s > 0.0001 ? c / s : vec3(0.0), clamp(s, 0.0, 1.0));
  vCavity = aCavity;
}
`;

/**
 * Rounds every finger off at its own edge: the surface darkens a little as it turns away from the eye, so a finger
 * lying in front of another keeps a soft dark rim against it and a curled hand still shows each finger.
 */
const EDGE_FRAG = /* glsl */ `
#ifndef FLAT_SHADED
{
  float facing = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
  gl_FragColor.rgb *= 1.0 - uEdge * pow( 1.0 - facing, 1.6 );
}
#endif
`;

/** Per-finger tint state shared by a hand's fill material: linear RGB per finger and an on/off weight. */
export interface FingerTints {
  colors: Float32Array;
  on: Float32Array;
}

/**
 * Lets one material tint single fingers: the mesh's aFingerA/aFingerB weights pick the finger, so a wrong finger turns
 * vermilion up to its knuckle crease while the rest of the hand keeps the base colour (multiplied by any map, as wood).
 */
function withFingerTints<M extends Material>(mat: M, tints: FingerTints, cavity: number, edge: number): M {
  const uniforms = { uFingerTint: { value: tints.colors }, uFingerOn: { value: tints.on }, uCavity: { value: cavity }, uEdge: { value: edge } };
  return patchShader(mat, edge > 0 ? 'finger-tint-v2-edge' : 'finger-tint-v2', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TINT_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TINT_VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFingerTint;\nvarying float vCavity;\nuniform float uCavity;\nuniform float uEdge;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( mix( diffuse, vFingerTint.rgb, vFingerTint.a ) * ( 1.0 - uCavity * vCavity ), opacity );')
      .replace('#include <dithering_fragment>', edge > 0 ? `#include <dithering_fragment>\n${EDGE_FRAG}` : '#include <dithering_fragment>');
  });
}

/**
 * Ink hull for a skinned mesh: the same skinned geometry pushed out along its skinned normals and drawn back faces
 * only, so the outline bends with the fingers. `width` is in hand-space units.
 *
 * The hull is also pushed a few widths away from the camera. At the silhouette that changes nothing (there is only
 * background behind it), but inside a fold, such as the palm crease of a curled hand, the hull of the far side no longer
 * pokes through the near skin, so creases stay clean and only the outer contour is inked.
 */
const OUTLINE_DEPTH_BIAS = 3;

function outlineMaterial(color: string, width: number): MeshBasicMaterial {
  const uniforms = { uOutline: { value: width }, uOutlineBias: { value: width * OUTLINE_DEPTH_BIAS } };
  return patchShader(new MeshBasicMaterial({ color, side: BackSide }), 'hand-outline-v2', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;\nuniform float uOutlineBias;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n#ifdef USE_SKINNING\ntransformed += normalize( objectNormal ) * uOutline;\n#endif')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nmvPosition.xyz += normalize( mvPosition.xyz ) * uOutlineBias * length( modelViewMatrix[ 0 ].xyz );\ngl_Position = projectionMatrix * mvPosition;',
      );
  });
}

/**
 * Translucent overlay in the manner of a tracked-hand view: a fresnel rim (edges more opaque than the face), constant
 * slight transparency, and a fade along the forearm so the hand dissolves at the wrist instead of ending in a cut.
 */
function withRimAndFade<M extends Material>(mat: M, rim: number, rimColor: Color): M {
  const uniforms = { uRim: { value: rim }, uRimColor: { value: rimColor } };
  return patchShader(mat, 'hand-rim-fade-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aForearm;\nvarying float vForearm;\nvarying vec3 vRimN;\nvarying vec3 vRimV;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvForearm = aForearm;\n#ifdef USE_SKINNING\nvRimN = normalize( normalMatrix * objectNormal );\n#else\nvRimN = vec3( 0.0, 0.0, 1.0 );\n#endif\nvRimV = -mvPosition.xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;\nvarying float vForearm;\nvarying vec3 vRimN;\nvarying vec3 vRimV;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
{
  float facing = abs( dot( normalize( vRimN ), normalize( vRimV ) ) );
  float rim = pow( 1.0 - facing, 2.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uRimColor, rim * 0.6 );
  gl_FragColor.a *= ( 1.0 - uRim + uRim * 2.6 * rim ) * ( 1.0 - smoothstep( 0.18, 0.8, vForearm ) );
}`,
      );
  });
}

/** How much each lit style darkens the folds between fingers and the creases (the mesh's aCavity), 0..1. */
const CAVITY = { chalk: 0.4, sketch: 0.45, wood: 0.55 };
/** How much each lit style darkens a surface turning away from the eye (EDGE_FRAG), 0..1. */
const EDGE = { chalk: 0.45, sketch: 0.4, wood: 0.5 };

export interface HandMaterialSet {
  /** The hand's skin material. One per hand, so fingers are tinted through `setTint`, not by swapping materials. */
  fill: Material;
  /** Ink or edge material for the skinned outline hull, or null when the style has none. */
  line: Material | null;
  /** Translucent styles: a depth-only material drawn just before the fill. */
  prepass?: Material;
  /** Base colour of the fill. */
  base: Color;
  /** Tints one finger (null clears it). Cheap: it writes two uniforms. */
  setTint: (finger: Finger, color: string | null) => void;
  dispose: () => void;
}

/** Builds the materials for one hand in one style. Call dispose() when the hand unmounts or restyles. */
export function createHandMaterials(style: HandStyle, stage: StageColors, tint?: string): HandMaterialSet {
  const owned: Material[] = [];
  const track = <M extends Material>(m: M): M => {
    owned.push(m);
    return m;
  };
  const tints: FingerTints = { colors: new Float32Array(15), on: new Float32Array(5) };
  const scratch = new Color();
  const setTint = (finger: Finger, color: string | null) => {
    const i = FINGER_ORDER.indexOf(finger);
    if (i < 0) return;
    tints.on[i] = color ? 1 : 0;
    if (color) {
      scratch.set(color);
      tints.colors.set([scratch.r, scratch.g, scratch.b], i * 3);
    }
  };
  const dispose = () => owned.forEach((m) => m.dispose());
  const finish = (fill: Material, line: Material | null, base: Color, cavity = 0, edge = 0): HandMaterialSet => ({ fill: track(withFingerTints(fill, tints, cavity, edge)), line: line && track(line), base, setTint, dispose });

  if (style === 'wood') {
    const w = getWoodTextures();
    const base = new Color(tint ?? '#ffffff');
    const fill = new MeshStandardMaterial({ color: base.clone(), map: w.color, normalMap: w.normal, roughnessMap: w.roughness, roughness: 0.78, metalness: 0 });
    return finish(fill, outlineMaterial('#2a1b10', 0.012), base, CAVITY.wood, EDGE.wood);
  }

  if (style === 'ghost' || style === 'shadow') {
    const ghost = style === 'ghost';
    const base = new Color(tint ?? (ghost ? stage.ghost : stage.shadow));
    const fill = new MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: ghost ? 0.3 : 0.4, depthWrite: false, depthFunc: LessEqualDepth });
    // The rim lightens a pale ghost (a glow on a dark bench) and stays the base colour for a dark one (ink on paper).
    const rim = base.getHSL({ h: 0, s: 0, l: 0 }).l > 0.6 ? base.clone().lerp(new Color('#ffffff'), 0.4) : base.clone();
    const set = finish(withRimAndFade(fill, ghost ? 0.55 : 0.25, rim), null, base);
    // Depth-only pass drawn just before the fill, so only the nearest layer of the one translucent skin shows.
    set.prepass = track(new MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true }));
    return set;
  }

  if (style === 'sketch') {
    const base = new Color(tint ?? stage.chalk);
    const fill = withHatching(new MeshToonMaterial({ color: base.clone(), gradientMap: handGradient() }), { ink: stage.ink, strength: 0.7, spacing: 5, base: 1.08 });
    return finish(fill, outlineMaterial(stage.ink, 0.022), base, CAVITY.sketch, EDGE.sketch);
  }

  const base = new Color(tint ?? stage.chalk);
  return finish(new MeshToonMaterial({ color: base.clone(), gradientMap: handGradient() }), outlineMaterial(stage.ink, 0.016), base, CAVITY.chalk, EDGE.chalk);
}
