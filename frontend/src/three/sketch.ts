import { Color, ShadowMaterial, type Material } from 'three';

/**
 * Codex sketch shading: screen-space ink hatching laid over a lit material, so a lit 3D model reads as an iron-gall
 * study drawing. Light areas stay clean, the half tone gets single diagonal strokes and the core shadow cross-hatching.
 * The strokes are fixed to the screen, which is fine for a study plate; a moving hand shows a slight "shower door".
 */

const HATCH_GLSL = /* glsl */ `
{
  float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(uHatchBase, 0.05);
  vec2 q = gl_FragCoord.xy;
  float s = uHatchSpacing;
  float da = abs(fract((q.x + q.y) / s) - 0.5) * s;
  float db = abs(fract((q.x - q.y) / s + 0.5) - 0.5) * s;
  float la = 1.0 - smoothstep(0.3, 1.1, da);
  float lb = 1.0 - smoothstep(0.3, 1.1, db);
  float w1 = 1.0 - smoothstep(0.66, 0.8, lum);
  float w2 = 1.0 - smoothstep(0.42, 0.56, lum);
  float h = max(la * w1, lb * w2);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHatchInk, h * uHatchStrength);
}
`;

export interface HatchOptions {
  /** Ink colour of the strokes. */
  ink: string;
  /** 0..1 stroke opacity. Default 0.7. */
  strength?: number;
  /** Stroke spacing in device pixels. Default 5. */
  spacing?: number;
  /** Luminance (0..1, display space) of the fill when fully lit, so thresholds follow the fill colour. Default 0.86. */
  base?: number;
}

/** Patches a lit material (toon, standard, lambert) to draw ink hatching in its darker tones. Returns the material. */
export function withHatching<M extends Material>(mat: M, { ink, strength = 0.7, spacing = 5, base = 0.86 }: HatchOptions): M {
  const uniforms = {
    uHatchInk: { value: new Color(ink) },
    uHatchStrength: { value: strength },
    uHatchSpacing: { value: spacing },
    uHatchBase: { value: base },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader =
      'uniform vec3 uHatchInk;\nuniform float uHatchStrength;\nuniform float uHatchSpacing;\nuniform float uHatchBase;\n' +
      shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${HATCH_GLSL}`);
  };
  mat.customProgramCacheKey = () => 'codex-hatch-v1';
  return mat;
}

/**
 * A shadow catcher whose cast shadows are drawn as diagonal ink strokes rather than a grey blur. Lay it on a plane just
 * above the paper; everything else about it is a plain ShadowMaterial.
 */
export function createHatchedShadowMaterial(ink: string, opacity = 0.55, spacing = 5): ShadowMaterial {
  const mat = new ShadowMaterial({ color: new Color(ink), opacity, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHatchSpacing = { value: spacing };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uHatchSpacing;\nvoid main() {')
      .replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        `float sm = 1.0 - getShadowMask();
  vec2 q = gl_FragCoord.xy;
  float d = abs(fract((q.x - q.y * 0.6) / uHatchSpacing) - 0.5) * uHatchSpacing;
  float stroke = 1.0 - smoothstep(0.35, 1.2, d);
  gl_FragColor = vec4( color, opacity * sm * (0.28 + 0.72 * stroke) );`,
      );
  };
  mat.customProgramCacheKey = () => 'codex-shadow-hatch-v1';
  return mat;
}
