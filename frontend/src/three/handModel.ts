import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, SkinnedMesh, Uint16BufferAttribute, Vector3, type Object3D } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildLayout, CHAINS, palmFrame, WRIST, type HandLayout } from './handPose';

/**
 * The skinned hand mesh: the Godot XR Tools right hand (CC0, made with MakeHuman; see public/models/hands/LICENSE.md),
 * its joints renamed to the WebXR hand joint names and its wrist cut flat. Loaded once and turned into a template every
 * <Hand> instance shares: welded, its wrist capped and rounded off, subdivided once, knuckles raised, and given the
 * attributes the materials read. Loading is the only browser-bound part; buildHandTemplate is pure and runs in tests
 * against the same file.
 */

export const HAND_MODEL_URL = '/models/hands/right.glb';

/** Scene units per metre: about the size of the old procedural hand, so cameras and props keep their framing. */
export const HAND_SCALE = 12;
/** Hand-space z of the knuckle line; the old rig's knuckles sat at about -1. */
const KNUCKLE_Z = -1.0;
/**
 * Where the wrist starts to close, past the wrist joint, and how long the closing dome is (scene units, 12 per metre):
 * the hand closes from just before the wrist joint and ends about 2 cm past it.
 */
const WRIST_CREASE = -0.2;
const WRIST_END = 0.22;
/** Concavity (offset to the neighbours along the normal per edge length) over which a crease fades into aCavity. */
const CREASE_FROM = 0.04;
const CREASE_TO = 0.2;
/** One Loop subdivision pass: about 3k triangles become 12k, enough for smooth close-up silhouettes. */
const SUBDIVIDE = true;

export interface HandTemplate {
  /** Welded, subdivided skinned geometry in hand space: position, normal, uv, skin, aFingerA, aFingerB, aForearm, aCavity. */
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
  const capped = closeHoles(geo);
  geo.dispose();
  geo = capped;
  taperWrist(geo, wrist);
  if (SUBDIVIDE) {
    const sub = loopSubdivide(geo);
    geo.dispose();
    geo = sub;
  }
  geo.computeVertexNormals();
  raiseKnuckles(geo, layout);
  geo.computeVertexNormals();
  addHandAttributes(geo, layout, wrist);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const bb = geo.boundingBox as NonNullable<BufferGeometry['boundingBox']>;
  const wristBack = new Vector3(wrist.x, bb.max.y * 0.8, wrist.z);
  return { geometry: geo, layout, wristBack };
}

/** Concentric rings laid across each hole when it is capped, so the wrist dome has rows to bend. */
const CAP_RINGS = 4;

/**
 * Closes every hole in a welded triangle mesh (the model's wrist is cut open) with a cap of concentric rings
 * shrinking to the hole's centroid, wound to match the surface. Cap vertices follow the wrist bone alone.
 */
export function closeHoles(geo: BufferGeometry): BufferGeometry {
  const P = geo.attributes.position;
  const SI = geo.attributes.skinIndex;
  const SW = geo.attributes.skinWeight;
  const idx = Array.from((geo.index as BufferAttribute).array);
  const half = new Set<number>();
  const n = P.count;
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) half.add(idx[t + k] * n + idx[t + ((k + 1) % 3)]);
  // Boundary half-edges a -> b have no twin b -> a; following them walks each hole's rim.
  const next = new Map<number, number>();
  half.forEach((e) => {
    const a = Math.floor(e / n);
    const b = e % n;
    if (!half.has(b * n + a)) next.set(a, b);
  });
  const pos = Array.from(P.array as ArrayLike<number>);
  const sIdx = Array.from(SI.array as ArrayLike<number>);
  const sW = Array.from(SW.array as ArrayLike<number>);
  const add = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    sIdx.push(0, 0, 0, 0);
    sW.push(1, 0, 0, 0);
    return pos.length / 3 - 1;
  };
  const seen = new Set<number>();
  next.forEach((_, start) => {
    if (seen.has(start)) return;
    const loop: number[] = [];
    for (let v: number | undefined = start; v !== undefined && !seen.has(v); v = next.get(v)) {
      seen.add(v);
      loop.push(v);
    }
    if (loop.length < 3) return;
    const c = [0, 0, 0];
    for (const v of loop) for (let k = 0; k < 3; k++) c[k] += pos[v * 3 + k] / loop.length;
    let outer = loop;
    for (let r = 1; r <= CAP_RINGS; r++) {
      const t = r / (CAP_RINGS + 1);
      const inner = loop.map((v) => add(...([0, 1, 2].map((k) => pos[v * 3 + k] + (c[k] - pos[v * 3 + k]) * t) as [number, number, number])));
      for (let i = 0; i < loop.length; i++) {
        const j = (i + 1) % loop.length;
        idx.push(outer[j], outer[i], inner[i], outer[j], inner[i], inner[j]);
      }
      outer = inner;
    }
    const centre = add(c[0], c[1], c[2]);
    for (let i = 0; i < loop.length; i++) idx.push(outer[(i + 1) % loop.length], outer[i], centre);
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('skinIndex', new Uint16BufferAttribute(sIdx, 4));
  out.setAttribute('skinWeight', new Float32BufferAttribute(sW, 4));
  out.setIndex(idx);
  return out;
}

/**
 * The model's wrist ends in a short tube with a flat cap, which reads as a blunt stump from behind the hand. Everything
 * past the wrist crease is re-laid as a half egg: the tube and its cap are unrolled by surface distance from the crease
 * and wrapped onto an elliptical dome WRIST_END long, so the hand closes in a soft, tapered end a few centimetres past
 * the wrist (the cut a tracked hand makes), with no edge or cap facing any camera.
 */
function taperWrist(geo: BufferGeometry, wrist: Vector3): void {
  const p = geo.attributes.position;
  const zs = wrist.z + WRIST_CREASE;
  // The wrist's cross-section at the crease: centre and semi-axes of the ellipse the tube follows.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let zMax = zs;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    zMax = Math.max(zMax, z);
    if (Math.abs(z - zs) > 0.06) continue;
    x0 = Math.min(x0, p.getX(i));
    x1 = Math.max(x1, p.getX(i));
    y0 = Math.min(y0, p.getY(i));
    y1 = Math.max(y1, p.getY(i));
  }
  if (!Number.isFinite(x0) || zMax <= zs) return;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const a = (x1 - x0) / 2;
  const b = (y1 - y0) / 2;
  const tube = zMax - zs;
  const total = tube + (a + b) / 2;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z <= zs) continue;
    const dx = p.getX(i) - cx;
    const dy = p.getY(i) - cy;
    const rho = Math.min(1, Math.hypot(dx / a, dy / b));
    // Surface distance from the crease: along the tube, then in across the cap towards its centre.
    const u = Math.min(z - zs, tube) + (1 - rho) * (total - tube);
    const th = (Math.PI / 2) * Math.min(1, u / total);
    const k = rho > 1e-6 ? Math.cos(th) / rho : 0;
    p.setXYZ(i, cx + dx * k, cy + dy * k, zs + WRIST_END * Math.sin(th));
  }
  p.needsUpdate = true;
}

/**
 * Knuckle relief. The model's back of the hand is smooth, so a curled hand seen from above reads as one rounded lump.
 * The heads of the metacarpals (the knuckles of a fist) and, smaller, the finger joints are raised on the back of the
 * hand only, where they show; the skin weights carry each bump with its joint as the fingers bend.
 */
const KNUCKLE_RELIEF: readonly { joint: number; height: number; radius: number }[] = [
  { joint: 1, height: 0.055, radius: 0.13 },
  { joint: 2, height: 0.03, radius: 0.09 },
  { joint: 3, height: 0.018, radius: 0.07 },
];

function raiseKnuckles(geo: BufferGeometry, layout: HandLayout): void {
  const p = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const bumps: { at: Vector3; height: number; r2: number }[] = [];
  for (let f = 1; f < 5; f++)
    for (const k of KNUCKLE_RELIEF) {
      const at = layout.bones.find((b) => b.name === CHAINS[f][k.joint])?.worldPosition;
      if (at) bumps.push({ at, height: k.height, r2: k.radius * k.radius });
    }
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    const dorsal = smoothstep(0.15, 0.7, nrm.getY(i));
    if (dorsal <= 0) continue;
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    let lift = 0;
    for (const b of bumps) {
      // Distance in the plane of the hand: the joint centre sits mid-finger, the skin above it.
      const dx = v.x - b.at.x;
      const dz = v.z - b.at.z;
      lift += b.height * Math.exp(-(dx * dx + dz * dz) / b.r2);
    }
    lift *= dorsal;
    p.setXYZ(i, v.x + nrm.getX(i) * lift, v.y + nrm.getY(i) * lift, v.z + nrm.getZ(i) * lift);
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
 * - aForearm: 0 just before the wrist crease to 1 at the closed end, for the translucent styles' wrist fade.
 * - aCavity: 0..1, how far a vertex sits in a fold: the sides of the fingers that face a neighbouring finger, and the
 *   concave creases (webbing, palm lines, the valleys between knuckles). The lit styles darken it a little, so fingers
 *   pressed together in a fist or a grip still read as separate fingers.
 * - uv: wood grain running along each bone (so it follows every finger, splayed or curled) and wrapping down the
 *   finger sides, blended by the skin weights so it has no seams.
 */
function addHandAttributes(geo: BufferGeometry, layout: HandLayout, wrist: Vector3): void {
  const n = geo.attributes.position.count;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const nrm = geo.attributes.normal;
  const fingerOf = new Int8Array(layout.bones.length).fill(-1);
  CHAINS.forEach((chain, f) =>
    chain.forEach((name, k) => {
      if (k === 0 && f !== 0) return;
      fingerOf[layout.bones.findIndex((b) => b.name === name)] = f;
    }),
  );
  const frames = boneFrames(layout);
  const concave = concavity(geo);
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n);
  const fore = new Float32Array(n);
  const cav = new Float32Array(n);
  const uv = new Float32Array(n * 2);
  const w = [0, 0, 0, 0, 0];
  const zA = wrist.z + WRIST_CREASE - 0.08;
  const zB = wrist.z + WRIST_CREASE + WRIST_END;
  const p = new Vector3();
  const nv = new Vector3();
  const rel = new Vector3();
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
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    nv.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    // Grain: along the bone (v) and across it (u), unrolled down the finger sides by the height below the bone's centre
    // line, weighted by how sideways the surface faces, so the sides carry grain instead of one smeared colour.
    let u = 0;
    let v = 0;
    let side = 0;
    for (let c = 0; c < 4; c++) {
      const wt = sw.getComponent(i, c);
      if (wt <= 0) continue;
      const fr = frames[si.getComponent(i, c)];
      rel.copy(p).sub(fr.origin);
      const ns = nv.dot(fr.side);
      u += wt * (p.dot(fr.side) - ns * rel.dot(fr.up));
      v += wt * (fr.start + rel.dot(fr.along));
      side += wt * ns;
    }
    uv[i * 2] = u * 0.55;
    uv[i * 2 + 1] = -v * 0.3;
    // Finger sides that face another finger: the ulnar side of the index, both sides of middle and ring, the radial
    // side of the little finger.
    const facing = smoothstep(0.35, 0.9, Math.abs(side));
    const inner = w[2] + w[3] + w[1] * smoothstep(-0.2, 0.2, -side) + w[4] * smoothstep(-0.2, 0.2, side);
    cav[i] = Math.min(1, facing * Math.min(1, inner) * 0.8 + concave[i]) * (1 - smoothstep(0, 0.25, fore[i]));
  }
  geo.setAttribute('aFingerA', new BufferAttribute(a, 4));
  geo.setAttribute('aFingerB', new BufferAttribute(b, 1));
  geo.setAttribute('aForearm', new BufferAttribute(fore, 1));
  geo.setAttribute('aCavity', new BufferAttribute(cav, 1));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

interface BoneFrame {
  origin: Vector3;
  /** Unit direction from the bone to its child (the finger's long axis). */
  along: Vector3;
  /** Unit direction across the bone towards the thumb side, in the plane of the hand. */
  side: Vector3;
  /** Unit direction out of the back of the bone. */
  up: Vector3;
  /** Distance from the wrist along the chain to this bone, so the grain runs on from bone to bone. */
  start: number;
}

/** A frame per bone from the bind pose: long axis, sideways and dorsal directions, and its distance along the chain. */
function boneFrames(layout: HandLayout): BoneFrame[] {
  const { bones, palm } = layout;
  const child = new Map<number, number>();
  bones.forEach((d, i) => {
    if (d.parent >= 0 && !child.has(d.parent)) child.set(d.parent, i);
  });
  // The wrist's first child is the thumb's metacarpal; the palm runs along the middle finger's instead.
  const middle = bones.findIndex((d) => d.name === CHAINS[2][0]);
  if (middle >= 0) child.set(0, middle);
  const frames: BoneFrame[] = [];
  bones.forEach((d, i) => {
    const c = child.get(i);
    const along = c !== undefined ? bones[c].worldPosition.clone().sub(d.worldPosition) : d.parent >= 0 ? d.worldPosition.clone().sub(bones[d.parent].worldPosition) : palm.distal.clone();
    if (along.lengthSq() < 1e-10) along.copy(palm.distal);
    along.normalize();
    const up = new Vector3().crossVectors(along, palm.radial).normalize();
    if (up.dot(palm.palmar) > 0) up.negate();
    const side = new Vector3().crossVectors(up, along).normalize();
    if (side.dot(palm.radial) < 0) side.negate();
    const start = d.parent >= 0 ? frames[d.parent].start + d.worldPosition.distanceTo(bones[d.parent].worldPosition) : 0;
    frames.push({ origin: d.worldPosition.clone(), along, side, up, start });
  });
  return frames;
}

/**
 * Per-vertex concavity, 0..1: how far a vertex sits below the mean of its neighbours along its normal, relative to the
 * local edge length. Creases and the webbing between fingers score high, flat and convex skin zero.
 */
function concavity(geo: BufferGeometry): Float32Array {
  const P = geo.attributes.position;
  const N = geo.attributes.normal;
  const idx = (geo.index as BufferAttribute).array;
  const n = P.count;
  const sum = new Float32Array(n * 3);
  const len = new Float32Array(n);
  const cnt = new Uint16Array(n);
  for (let t = 0; t < idx.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const i = idx[t + k];
      const j = idx[t + ((k + 1) % 3)];
      const dx = P.getX(j) - P.getX(i);
      const dy = P.getY(j) - P.getY(i);
      const dz = P.getZ(j) - P.getZ(i);
      const l = Math.hypot(dx, dy, dz);
      sum[i * 3] += dx;
      sum[i * 3 + 1] += dy;
      sum[i * 3 + 2] += dz;
      sum[j * 3] -= dx;
      sum[j * 3 + 1] -= dy;
      sum[j * 3 + 2] -= dz;
      len[i] += l;
      len[j] += l;
      cnt[i] += 1;
      cnt[j] += 1;
    }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!cnt[i]) continue;
    // Mean offset to the neighbours along the normal, over the mean edge length: positive in a fold.
    const d = (sum[i * 3] * N.getX(i) + sum[i * 3 + 1] * N.getY(i) + sum[i * 3 + 2] * N.getZ(i)) / len[i];
    out[i] = smoothstep(CREASE_FROM, CREASE_TO, d);
  }
  return out;
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
