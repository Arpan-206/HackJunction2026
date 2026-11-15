// TEMPORARY probe (removed before hand-back): poses the mesh from captured core frames, per segment, and compares it
// with the core skeleton. PROBE_FILE = segments.json from the scratchpad.
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FINGER_ORDER } from '../src/three/anatomy';
import { buildHandTemplate, type HandTemplate } from '../src/three/handModel';
import { applyHandPose, applyJointPose, createBones, CHAINS, isCoreAngleSpread } from '../src/three/handPose';

const FILE = process.env.PROBE_FILE ?? '';
const BASE = [2, 6, 11, 16, 21];
type H = { joints_local: number[][]; flexion: Record<string, number[]>; spread: Record<string, number> };

/** Joints in a palm frame: origin wrist, axes radial, palmar, distal, scaled by the wrist to middle knuckle length. */
function normalise(pts: Vector3[]): { p: Vector3[]; len: number } {
  const w = pts[1];
  const d = pts[BASE[2] + 1].clone().sub(w);
  const len = d.length();
  d.normalize();
  const r = pts[BASE[1] + 1].clone().sub(pts[BASE[4] + 1]);
  r.addScaledVector(d, -r.dot(d)).normalize();
  const n = new Vector3().crossVectors(r, d).normalize();
  return { p: pts.map((v) => { const x = v.clone().sub(w); return new Vector3(x.dot(r), x.dot(n), x.dot(d)).divideScalar(len); }), len };
}

function meshJoints(tpl: HandTemplate, h: H, mode: string, mirror: boolean): Vector3[] {
  const root = new Group();
  const bones = createBones(tpl.layout, root);
  const flex = FINGER_ORDER.flatMap((f) => h.flexion[f]);
  const spread = FINGER_ORDER.map((f) => h.spread[f] ?? 0);
  applyHandPose(bones, tpl.layout, flex, spread, undefined, mode !== 'old' && isCoreAngleSpread(h.spread));
  if (mode === 'joints') applyJointPose(bones, tpl.layout, h.joints_local.flatMap((v) => [mirror ? -v[0] : v[0], v[1], v[2]]));
  root.updateMatrixWorld(true);
  const at = (n: string) => bones[tpl.layout.bones.findIndex((b) => b.name === n)].getWorldPosition(new Vector3());
  const out: Vector3[] = new Array(26).fill(null).map(() => new Vector3());
  out[1] = at('wrist');
  CHAINS.forEach((c, f) => c.forEach((n, k) => (out[BASE[f] + k] = at(n))));
  out[0] = out[BASE[2]].clone().lerp(out[BASE[2] + 1], 0.5);
  return out;
}

const deg = (a: Vector3, b: Vector3) => (Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize())))) * 180) / Math.PI;

it('probe', async () => {
  if (!FILE) return;
  (globalThis as { __V?: string }).__V = process.env.PROBE_V ?? '';
  const buf = fs.readFileSync(path.resolve(__dirname, '../public/models/hands/right.glb'));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const tpl = buildHandTemplate(gltf.scene);
  const segs = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, { frames: Record<string, H>[] }>;
  const lines: string[] = ['segment     mode    dir_err(th,in,mi,ri,li)        mean  pos_cm tip_cm thumbtip_cm spread_err'];
  const total: Record<string, number[]> = {};
  for (const [name, seg] of Object.entries(segs)) {
    for (const mode of (process.env.PROBE_MODES ?? 'old,angles,joints').split(',')) {
      const fe = [0, 0, 0, 0, 0];
      let pos = 0;
      let tip = 0;
      let ttip = 0;
      let sp = 0;
      let n = 0;
      for (const fr of seg.frames)
        for (const side of ['left', 'right']) {
          const h = fr[side];
          if (!h) continue;
          const mirror = side === 'left';
          const core = h.joints_local.map((v) => new Vector3(mirror ? -v[0] : v[0], v[1], v[2]));
          const mesh = meshJoints(tpl, h, mode, mirror);
          const C = normalise(core);
          const M = normalise(mesh);
          for (let f = 0; f < 5; f++) {
            const segsK = f === 0 ? [0, 1, 2] : [1, 2, 3];
            for (const k of segsK) fe[f] += deg(C.p[BASE[f] + k + 1].clone().sub(C.p[BASE[f] + k]), M.p[BASE[f] + k + 1].clone().sub(M.p[BASE[f] + k])) / 3;
          }
          let pe = 0;
          let pc = 0;
          for (let f = 0; f < 5; f++) for (let k = 1; k < (f === 0 ? 4 : 5); k++) { pe += C.p[BASE[f] + k].distanceTo(M.p[BASE[f] + k]); pc++; }
          pos += (pe / pc) * C.len * 100;
          let te = 0;
          for (let f = 1; f < 5; f++) te += C.p[BASE[f] + 4].distanceTo(M.p[BASE[f] + 4]) / 4;
          tip += te * C.len * 100;
          ttip += C.p[5].distanceTo(M.p[5]) * C.len * 100;
          // Spread: yaw between index and little proximal phalanges in the palm plane.
          const yaw = (P: Vector3[], f: number) => { const v = P[BASE[f] + 2].clone().sub(P[BASE[f] + 1]); return Math.atan2(v.x, v.z); };
          sp += (Math.abs(yaw(C.p, 1) - yaw(C.p, 4) - (yaw(M.p, 1) - yaw(M.p, 4))) * 180) / Math.PI;
          n++;
        }
      const m = fe.map((x) => x / n);
      const mean = m.reduce((a, b) => a + b, 0) / 5;
      (total[mode] ??= []).push(mean);
      lines.push(`${name.padEnd(11)} ${mode.padEnd(7)} ${m.map((x) => x.toFixed(0).padStart(4)).join(' ')}   ${mean.toFixed(1).padStart(5)}  ${(pos / n).toFixed(1).padStart(5)}  ${(tip / n).toFixed(1).padStart(5)}  ${(ttip / n).toFixed(1).padStart(8)}  ${(sp / n).toFixed(0).padStart(6)}`);
    }
  }
  for (const [k, v] of Object.entries(total)) lines.push(`ALL ${k}: mean dir err ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}`);
  fs.writeFileSync(process.env.PROBE_OUT ?? path.resolve(__dirname, '../probe-out.txt'), lines.join('\n'));
});
