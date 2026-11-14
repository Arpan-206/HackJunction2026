import { BackSide, Color, Material, MeshBasicMaterial, MeshToonMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import type { Finger } from '../../api/types';
import { FINGER_ORDER } from '../anatomy';
import { toonGradient } from '../materials';
import type { StageColors } from '../../theme/themes';

/**
 * Materials for the robot twin: light steel toon shading (dark iron vanished on the walnut bench) with the stage's ink outline, bronze joint rings, and a chalk
 * ghost for the fingers the robot lacks. No gold (mastery only), no vermilion (corrections only).
 */

const IRON = '#8d949e';
const IRON_PALM = '#6c737e';
const BRONZE = '#a2733d';

/**
 * Ink hull for an unskinned mesh: the same geometry pushed out along its vertex normals and drawn back faces only.
 * `width` is in the mesh's local units (metres for the URDF capsules).
 */
export function robotOutlineMaterial(color: string, width: number): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ color, side: BackSide });
  const uniforms = { uOutline: { value: width } };
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize( normal ) * uOutline;');
  };
  mat.customProgramCacheKey = () => 'robot-outline-v1';
  return mat;
}

export interface RobotMaterialSet {
  /** One fill per finger, so a finger can be tinted on its own. */
  fingers: Record<Finger, MeshToonMaterial>;
  palm: MeshToonMaterial;
  bronze: MeshToonMaterial;
  ghost: MeshBasicMaterial;
  outline: MeshBasicMaterial;
  setTint: (finger: Finger, color: string | null) => void;
  dispose: () => void;
}

export function createRobotMaterials(stage: StageColors): RobotMaterialSet {
  const owned: Material[] = [];
  const track = <M extends Material>(m: M): M => {
    owned.push(m);
    return m;
  };
  const gradient = toonGradient();
  const fingers = {} as Record<Finger, MeshToonMaterial>;
  for (const f of FINGER_ORDER) fingers[f] = track(new MeshToonMaterial({ color: IRON, gradientMap: gradient }));
  const palm = track(new MeshToonMaterial({ color: IRON_PALM, gradientMap: gradient }));
  const bronze = track(new MeshToonMaterial({ color: BRONZE, gradientMap: gradient }));
  const ghost = track(new MeshBasicMaterial({ color: new Color(stage.chalk), transparent: true, opacity: 0.16, depthWrite: false }));
  const outline = track(robotOutlineMaterial(stage.ink, 0.0012));
  const base = new Color(IRON);
  return {
    fingers,
    palm,
    bronze,
    ghost,
    outline,
    setTint: (finger, color) => fingers[finger].color.copy(color ? new Color(color) : base),
    dispose: () => owned.forEach((m) => m.dispose()),
  };
}
