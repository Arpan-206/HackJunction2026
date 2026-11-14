import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, SkinnedMesh, Uint16BufferAttribute, Vector3, type Object3D } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildLayout, CHAINS, palmFrame, WRIST, type HandLayout } from './handPose';

/**
 * The skinned hand mesh: the WebXR Input Profiles generic-hand (MIT, see public/models/hands/LICENSE.md), loaded once
 * and turned into a template every <Hand> instance shares. Loading is the only browser-bound part; buildHandTemplate
 * is pure and runs in tests against the same file.
 */

export const HAND_MODEL_URL = '/models/hands/right.glb';

/** Scene units per metre: about the size of the old procedural hand, so cameras and props keep their framing. */
export const HAND_SCALE = 12;
/** Hand-space z of the knuckle line; the old rig's knuckles sat at about -1. */
const KNUCKLE_Z = -1.0;
/** How far the wrist is drawn out into a short forearm (scene units), and how much it widens on the way. */
const FOREARM_LENGTH = 0.16;
const FOREARM_WIDEN = 0.03;
/** One Loop subdivision pass: 2.3k triangles become 9.3k, enough for smooth close-up silhouettes. */
const SUBDIVIDE = true;

export interface HandTemplate {
  /** Welded, subdivided skinned geometry in hand space with position, normal, uv, skin, aFingerA, aFingerB, aForearm. */
  geometry: BufferGeometry;
  layout: HandLayout;
  /** A point on the back of the wrist (hand space), for leader lines. */
  wristBack: Vector3;
}

/** Converts the loaded glTF scene into a hand-space template. */
export function buildHandTemplate(scene: Object3D): HandTemplate {
  scene.updateMatrixWorld(true);
  let mesh: SkinnedMesh | null = null;
  scene.traverse((o) => {
    if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  if (!mesh) throw new Error('Hand model has no skinned mesh');
  const skinned: SkinnedMesh = mesh;
  const skeleton = skinned.skeleton;

  // Bind pose in model space, from the inverse bind matrices (what the skin was authored against).
  const bindPos = new Map<string, Vector3>();
  const bindQuat = new Map<string, Quaternion>();
  skeleton.bones.forEach((b, i) => {
    const m = skeleton.boneInverses[i].clone().invert();
    const p = new Vector3();
    const q = new Quaternion();
    m.decompose(p, q, new Vector3());
    bindPos.set(b.name, p);
    bindQuat.set(b.name, q);
  });
  for (const n of [WRIST, ...CHAINS.flat()]) if (!bindPos.has(n)) throw new Error(`Hand model lacks joint ${n}`);

  // Model space to hand space: x ulnar, y dorsal, z proximal, measured from the palm itself.
  const pm = palmFrame((n) => bindPos.get(n) as Vector3);
  const ex = pm.radial.clone().negate();
  const ey = pm.palmar.clone().negate();
  const ez = pm.distal.clone().negate();
  ex.crossVectors(ey, ez).normalize();
  const rot = new Matrix4().set(ex.x, ex.y, ex.z, 0, ey.x, ey.y, ey.z, 0, ez.x, ez.y, ez.z, 0, 0, 0, 0, 1);
  const rotQ = new Quaternion().setFromRotationMatrix(rot);
  const origin = (bindPos.get(CHAINS[1][1]) as Vector3).clone().add(bindPos.get(CHAINS[4][1]) as Vector3).multiplyScalar(0.5);
  const toHand = new Matrix4()
    .makeTranslation(0, 0, KNUCKLE_Z)
    .multiply(new Matrix4().makeScale(HAND_SCALE, HAND_SCALE, HAND_SCALE))
    .multiply(rot)
    .multiply(new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));

  const world = new Map<string, { position: Vector3; quaternion: Quaternion }>();
  bindPos.forEach((p, n) => world.set(n, { position: p.clone().applyMatrix4(toHand), quaternion: rotQ.clone().multiply(bindQuat.get(n) as Quaternion) }));
  const layout = buildLayout((n) => world.get(n) as { position: Vector3; quaternion: Quaternion });

  // Geometry: drop the UV split so the surface is one welded shell, then bring it into hand space.
  const src = skinned.geometry.clone();
  src.applyMatrix4(skinned.bindMatrix);
  for (const k of Object.keys(src.attributes)) if (k !== 'position' && k !== 'skinIndex' && k !== 'skinWeight') src.deleteAttribute(k);
  src.applyMatrix4(toHand);
  let geo = mergeVertices(src, 1e-4);
  src.dispose();

  // Remap skin indices from the glTF joint order to the layout's bone order.
  const remap = skeleton.bones.map((b) => layout.bones.findIndex((d) => d.name === b.name));
  const si = geo.attributes.skinIndex;
  for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) si.setComponent(i, c, Math.max(0, remap[si.getComponent(i, c)]));

  const wrist = layout.bones[0].worldPosition;
  stretchForearm(geo, wrist);
  if (SUBDIVIDE) {
    const sub = loopSubdivide(geo);
    geo.dispose();
    geo = sub;
  }
  geo.computeVertexNormals();
  addHandAttributes(geo, layout, wrist);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const bb = geo.boundingBox as NonNullable<BufferGeometry['boundingBox']>;
  const wristBack = new Vector3(wrist.x, bb.max.y * 0.8, wrist.z);
  return { geometry: geo, layout, wristBack };
}

/**
 * The model ends just past the wrist in a rounded cap. Everything beyond the wrist crease slides back along +z by
 * FOREARM_LENGTH and widens slightly, so the wrist runs smoothly into a short forearm with the cap at its end.
 */
function stretchForearm(geo: BufferGeometry, wrist: Vector3): void {
  const p = geo.attributes.position;
  const z0 = wrist.z - 0.06 * (HAND_SCALE / 12);
  const z1 = wrist.z + 0.16 * (HAND_SCALE / 12);
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z <= z0) continue;
    const t = smoothstep(z0, z1, z);
    const k = 1 + FOREARM_WIDEN * t;
    p.setXYZ(i, wrist.x + (p.getX(i) - wrist.x) * k, wrist.y + (p.getY(i) - wrist.y) * k, z + FOREARM_LENGTH * t);
  }
  p.needsUpdate = true;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Adds the attributes the hand materials read:
 * - aFingerA (thumb, index, middle, ring) and aFingerB (little): how much a vertex belongs to each finger, from its skin
 *   weights on that finger's phalanges (and the thumb metacarpal), sharpened so a tint stops at the knuckle crease.
 * - aForearm: 0 at the wrist crease to 1 at the end of the forearm, for the translucent styles' wrist fade.
 * - uv: a planar projection with the grain running along the fingers, for the wood maps.
 */
function addHandAttributes(geo: BufferGeometry, layout: HandLayout, wrist: Vector3): void {
  const n = geo.attributes.position.count;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const fingerOf = new Int8Array(layout.bones.length).fill(-1);
  CHAINS.forEach((chain, f) =>
    chain.forEach((name, k) => {
      if (k === 0 && f !== 0) return;
      fingerOf[layout.bones.findIndex((b) => b.name === name)] = f;
    }),
  );
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n);
  const fore = new Float32Array(n);
  const uv = new Float32Array(n * 2);
  const w = [0, 0, 0, 0, 0];
  const zA = wrist.z - 0.06;
  const zB = wrist.z + 0.16 + FOREARM_LENGTH + 0.12;
  for (let i = 0; i < n; i++) {
    w.fill(0);
    for (let c = 0; c < 4; c++) {
      const f = fingerOf[si.getComponent(i, c)];
      if (f >= 0) w[f] += sw.getComponent(i, c);
    }
    for (let f = 0; f < 5; f++) w[f] = smoothstep(0.25, 0.75, w[f]);
    a.set([w[0], w[1], w[2], w[3]], i * 4);
    b[i] = w[4];
    fore[i] = Math.min(1, Math.max(0, (pos.getZ(i) - zA) / (zB - zA)));
    uv[i * 2] = pos.getX(i) * 0.55;
    uv[i * 2 + 1] = pos.getZ(i) * 0.3;
  }
  geo.setAttribute('aFingerA', new BufferAttribute(a, 4));
  geo.setAttribute('aFingerB', new BufferAttribute(b, 1));
  geo.setAttribute('aForearm', new BufferAttribute(fore, 1));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

/**
 * One pass of Loop subdivision on a closed, welded triangle mesh. Skin weights of new edge points are the mean of the
 * edge's two ends (top four kept), so the smoothed surface still deforms with the bones.
 */
export function loopSubdivide(geo: BufferGeometry): BufferGeometry {
  const P = geo.attributes.position;
  const SI = geo.attributes.skinIndex;
  const SW = geo.attributes.skinWeight;
  const idx = (geo.index as BufferAttribute).array;
  const nv = P.count;
  const edges = new Map<number, { id: number; a: number; b: number; opp: number[] }>();
  const nbrs: Set<number>[] = Array.from({ length: nv }, () => new Set<number>());
  let next = nv;
  const edgeOf = (a: number, b: number, c: number) => {
    const key = a < b ? a * nv + b : b * nv + a;
    let e = edges.get(key);
    if (!e) {
      e = { id: next++, a, b, opp: [] };
      edges.set(key, e);
    }
    e.opp.push(c);
    nbrs[a].add(b);
    nbrs[b].add(a);
    return e.id;
  };
  const tris: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const ab = edgeOf(a, b, c);
    const bc = edgeOf(b, c, a);
    const ca = edgeOf(c, a, b);
    tris.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const total = next;
  const pos = new Float32Array(total * 3);
  const sIdx = new Uint16Array(total * 4);
  const sW = new Float32Array(total * 4);
  const get = (i: number, out: Vector3) => out.set(P.getX(i), P.getY(i), P.getZ(i));
  const v = new Vector3();
  const acc = new Vector3();
  for (let i = 0; i < nv; i++) {
    const ring = nbrs[i];
    const k = ring.size;
    const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
    acc.set(0, 0, 0);
    ring.forEach((j) => acc.add(get(j, v)));
    get(i, v).multiplyScalar(1 - k * beta).addScaledVector(acc, beta);
    pos.set([v.x, v.y, v.z], i * 3);
    for (let c = 0; c < 4; c++) {
      sIdx[i * 4 + c] = SI.getComponent(i, c);
      sW[i * 4 + c] = SW.getComponent(i, c);
    }
  }
  const mix = new Map<number, number>();
  edges.forEach((e) => {
    get(e.a, v).add(get(e.b, acc));
    if (e.opp.length === 2) {
      v.multiplyScalar(3 / 8);
      v.add(get(e.opp[0], acc).multiplyScalar(1 / 8)).add(get(e.opp[1], acc).multiplyScalar(1 / 8));
    } else v.multiplyScalar(0.5);
    pos.set([v.x, v.y, v.z], e.id * 3);
    mix.clear();
    for (const end of [e.a, e.b])
      for (let c = 0; c < 4; c++) {
        const j = SI.getComponent(end, c);
        mix.set(j, (mix.get(j) ?? 0) + SW.getComponent(end, c) * 0.5);
      }
    const top = [...mix.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = top.reduce((s, [, x]) => s + x, 0) || 1;
    top.forEach(([j, x], c) => {
      sIdx[e.id * 4 + c] = j;
      sW[e.id * 4 + c] = x / sum;
    });
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('skinIndex', new Uint16BufferAttribute(sIdx, 4));
  out.setAttribute('skinWeight', new BufferAttribute(sW, 4));
  out.setIndex(tris);
  return out;
}

let pending: Promise<HandTemplate | null> | null = null;
let ready: HandTemplate | null | undefined;

/** Loads and prepares the hand once; later calls share the promise. Resolves to null (and logs) if the file fails. */
export function loadHandTemplate(): Promise<HandTemplate | null> {
  if (!pending) {
    // The loader is only needed once, so it stays out of the main bundle.
    pending = import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(HAND_MODEL_URL))
      .then((gltf) => buildHandTemplate(gltf.scene))
      .catch((e: unknown) => {
        console.error('[hand] could not load the hand model', e);
        return null;
      })
      .then((t) => {
        ready = t;
        return t;
      });
  }
  return pending;
}

/** True once the hand model has loaded (or failed), so still captures know hands are drawn. Starts the load. */
export function handModelSettled(): boolean {
  if (ready === undefined) void loadHandTemplate();
  return ready !== undefined;
}

/** Suspends until the hand template is ready. Returns null when the model could not be loaded. */
export function useHandTemplate(): HandTemplate | null {
  if (ready !== undefined) return ready;
  throw loadHandTemplate();
}
