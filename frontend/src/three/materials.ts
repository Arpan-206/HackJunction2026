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
  ReplaceStencilOp,
  NotEqualStencilFunc,
  SRGBColorSpace,
  BackSide,
  Texture,
  TextureLoader,
  type Material,
} from 'three';
import type { StageColors } from '../theme/themes';
import { withHatching } from './sketch';

/**
 * How a hand is drawn. chalk: master, wood: apprentice marionette, ghost: translucent overlay, shadow: dark guidance,
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

let stencilCounter = 0;

/** Unique stencil reference (1..254) so overlapping translucent segments of one hand do not double up. */
export function nextStencilRef(): number {
  stencilCounter = (stencilCounter % 254) + 1;
  return stencilCounter;
}

function stencilise<M extends Material>(m: M, ref: number): M {
  m.stencilWrite = true;
  m.stencilRef = ref;
  m.stencilFunc = NotEqualStencilFunc;
  m.stencilFail = ReplaceStencilOp;
  m.stencilZFail = ReplaceStencilOp;
  m.stencilZPass = ReplaceStencilOp;
  return m;
}

export interface HandMaterialSet {
  /** Creates a fresh fill material (one per finger so each can be tinted). */
  fill: () => Material;
  /** Ink or edge material for the back-face outline, or null when the style has none. */
  line: Material | null;
  /** Outline inflation in scene units. */
  outline: number;
  /** Dark material for pegs and joint hardware (wood only). */
  peg: Material | null;
  /** Base colour of a fill, used when clearing tints. */
  base: Color;
  dispose: () => void;
}

/** Builds the materials for one hand in one style. Call dispose() when the hand unmounts or restyles. */
export function createHandMaterials(style: HandStyle, stage: StageColors, tint?: string): HandMaterialSet {
  const owned: Material[] = [];
  const track = <M extends Material>(m: M): M => {
    owned.push(m);
    return m;
  };
  const stencilRef = nextStencilRef();
  const dispose = () => owned.forEach((m) => m.dispose());

  if (style === 'wood') {
    const w = getWoodTextures();
    const base = new Color(tint ?? '#ffffff');
    return {
      fill: () =>
        track(
          new MeshStandardMaterial({
            color: base.clone(),
            map: w.color,
            normalMap: w.normal,
            roughnessMap: w.roughness,
            roughness: 0.82,
            metalness: 0,
          }),
        ),
      line: track(new MeshBasicMaterial({ color: '#2a1b10', side: BackSide })),
      outline: 0.009,
      peg: track(new MeshStandardMaterial({ color: '#5a3a22', roughness: 0.7, map: w.color, normalMap: w.normal })),
      base,
      dispose,
    };
  }

  if (style === 'ghost') {
    const base = new Color(tint ?? stage.ghost);
    return {
      fill: () => stencilise(track(new MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0.34, depthWrite: false })), stencilRef),
      line: null,
      outline: 0,
      peg: null,
      base,
      dispose,
    };
  }

  if (style === 'shadow') {
    const base = new Color(tint ?? stage.shadow);
    return {
      fill: () => stencilise(track(new MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0.42, depthWrite: false })), stencilRef),
      line: null,
      outline: 0,
      peg: null,
      base,
      dispose,
    };
  }

  if (style === 'sketch') {
    const base = new Color(tint ?? stage.chalk);
    const ink = track(new MeshBasicMaterial({ color: stage.ink, side: BackSide }));
    return {
      fill: () => track(withHatching(new MeshToonMaterial({ color: base.clone(), gradientMap: toonGradient() }), { ink: stage.ink, strength: 0.7, spacing: 5, base: 1.08 })),
      line: ink,
      outline: 0.018,
      peg: null,
      base,
      dispose,
    };
  }

  const base = new Color(tint ?? stage.chalk);
  const ink = track(new MeshBasicMaterial({ color: stage.ink, side: BackSide }));
  return {
    fill: () => track(new MeshToonMaterial({ color: base.clone(), gradientMap: toonGradient() })),
    line: ink,
    outline: 0.014,
    peg: null,
    base,
    dispose,
  };
}
