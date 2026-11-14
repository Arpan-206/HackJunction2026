import { MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';

/** A PBR texture set as served from /textures/<dir>. */
export interface PbrTextures {
  map: Texture;
  normalMap: Texture;
  roughnessMap: Texture;
  metalnessMap?: Texture;
}

const pbrCache = new Map<string, PbrTextures>();

/**
 * Lazily loads (and caches for the page lifetime) a 1k PBR set from /textures/<dir>. The set is shared by every
 * material built from it, so each surface costs at most four 1k maps. `repeat` tiles the surface.
 */
export function getPbrTextures(dir: string, repeat: [number, number], metal?: string): PbrTextures {
  const key = `${dir}:${repeat.join('x')}`;
  const hit = pbrCache.get(key);
  if (hit) return hit;
  const loader = new TextureLoader();
  const load = (file: string, srgb: boolean): Texture => {
    const t = loader.load(`/textures/${dir}/${file}`);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 4;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  const set: PbrTextures = {
    map: load('diff.jpg', true),
    normalMap: load('normal.jpg', false),
    roughnessMap: load('rough.jpg', false),
    metalnessMap: metal ? load(metal, false) : undefined,
  };
  pbrCache.set(key, set);
  return set;
}

/** Dark walnut veneer for the workbench top (CC0 ambientCG, /textures/black_walnut_veneer_02). */
export function getWalnutTextures(repeat: [number, number] = [2, 1.4]): PbrTextures {
  return getPbrTextures('black_walnut_veneer_02', repeat);
}

/** Polished marble (CC0, /textures/marble_01) for the keyboard base and plinths. */
export function getMarbleTextures(repeat: [number, number] = [1, 1]): PbrTextures {
  return getPbrTextures('marble_01', repeat);
}

/** Weathered lime plaster (CC0, /textures/worn_plaster_wall) for the back wall. */
export function getPlasterTextures(repeat: [number, number] = [3, 2]): PbrTextures {
  return getPbrTextures('worn_plaster_wall', repeat);
}

/**
 * Gold leaf (CC0 ambientCG Metal048B). Use for the mastery seal and mastery accents only: gold means verified. The
 * caller owns the returned material and should dispose it; the textures are shared and cached.
 */
export function createGoldLeafMaterial(tint = '#ffffff'): MeshStandardMaterial {
  const t = getPbrTextures('metal048b', [1, 1], 'metal.jpg');
  return new MeshStandardMaterial({
    color: tint,
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    metalnessMap: t.metalnessMap,
    metalness: 1,
    roughness: 1,
  });
}

/** Polished marble material built from the shared marble set. The caller owns and disposes the material. */
export function createMarbleMaterial(tint = '#ffffff', repeat: [number, number] = [1, 1]): MeshStandardMaterial {
  const t = getMarbleTextures(repeat);
  return new MeshStandardMaterial({ color: tint, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 0.9, metalness: 0 });
}
