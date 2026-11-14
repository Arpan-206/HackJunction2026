/**
 * A small URDF reader for the robot hand descriptions in public/models/robots. It reads what the renderer needs,
 * joints with their origins, axes and limits, and links with their centre of mass and first collision box, and nothing
 * else. It works on text, so it runs in the browser and in node tests alike (no DOMParser).
 */

export type Vec3 = [number, number, number];

export interface UrdfOrigin {
  xyz: Vec3;
  /** Roll, pitch, yaw in radians, URDF fixed-axis convention. */
  rpy: Vec3;
}

export interface UrdfJoint {
  name: string;
  type: string;
  parent: string;
  child: string;
  /** Joint frame in the parent link frame. */
  origin: UrdfOrigin;
  /** Rotation axis in the joint frame. */
  axis: Vec3;
  lower: number;
  upper: number;
}

export interface UrdfLink {
  name: string;
  /** Centre of mass in the link frame (metres), when the file gives one. */
  inertialOrigin: Vec3 | null;
  /** The first collision box, when the file gives one. */
  collisionBox: { size: Vec3; origin: UrdfOrigin } | null;
}

export interface UrdfModel {
  name: string;
  /** The link that no joint moves: the hand's palm. */
  root: string;
  links: UrdfLink[];
  joints: UrdfJoint[];
}

const ZERO: Vec3 = [0, 0, 0];

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

function vec(text: string | null, fallback: Vec3): Vec3 {
  if (!text) return [...fallback] as Vec3;
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) return [...fallback] as Vec3;
  return parts as Vec3;
}

/** The first `<tag .../>` or `<tag ...>` inside a block, as its opening tag text. */
function firstTag(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>`).exec(block);
  return m ? m[0] : null;
}

function origin(tag: string | null): UrdfOrigin {
  return { xyz: vec(tag ? attr(tag, 'xyz') : null, ZERO), rpy: vec(tag ? attr(tag, 'rpy') : null, ZERO) };
}

const MOVABLE = new Set(['revolute', 'continuous', 'prismatic']);

/** Parses a URDF document. Comments are dropped first, so a commented-out floating base is ignored. */
export function parseUrdf(text: string): UrdfModel {
  const src = text.replace(/<!--[\s\S]*?-->/g, '');
  const robotTag = firstTag(src, 'robot');
  const name = (robotTag && attr(robotTag, 'name')) || 'robot';

  const joints: UrdfJoint[] = [];
  for (const m of src.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)) {
    const head = `<joint${m[1]}>`;
    const body = m[2];
    const jname = attr(head, 'name');
    if (!jname) continue;
    const type = attr(head, 'type') ?? 'revolute';
    const parent = firstTag(body, 'parent');
    const child = firstTag(body, 'child');
    const limit = firstTag(body, 'limit');
    const axis = firstTag(body, 'axis');
    const movable = MOVABLE.has(type);
    joints.push({
      name: jname,
      type,
      parent: (parent && attr(parent, 'link')) ?? '',
      child: (child && attr(child, 'link')) ?? '',
      origin: origin(firstTag(body, 'origin')),
      axis: vec(axis ? attr(axis, 'xyz') : null, [0, 0, 1]),
      lower: movable ? Number((limit && attr(limit, 'lower')) ?? -Math.PI) : 0,
      upper: movable ? Number((limit && attr(limit, 'upper')) ?? Math.PI) : 0,
    });
  }

  const links: UrdfLink[] = [];
  for (const m of src.matchAll(/<link\b([^>]*?)(\/>|>([\s\S]*?)<\/link>)/g)) {
    const head = `<link${m[1]}>`;
    const lname = attr(head, 'name');
    if (!lname) continue;
    const body = m[3] ?? '';
    const inertial = /<inertial\b[^>]*>([\s\S]*?)<\/inertial>/.exec(body);
    const inertialOrigin = inertial ? firstTag(inertial[1], 'origin') : null;
    let collisionBox: UrdfLink['collisionBox'] = null;
    for (const c of body.matchAll(/<collision\b[^>]*>([\s\S]*?)<\/collision>/g)) {
      const box = firstTag(c[1], 'box');
      if (!box) continue;
      collisionBox = { size: vec(attr(box, 'size'), [0.01, 0.01, 0.01]), origin: origin(firstTag(c[1], 'origin')) };
      break;
    }
    links.push({ name: lname, inertialOrigin: inertialOrigin ? vec(attr(inertialOrigin, 'xyz'), ZERO) : null, collisionBox });
  }

  const children = new Set(joints.map((j) => j.child));
  const root = links.find((l) => !children.has(l.name))?.name ?? links[0]?.name ?? '';
  if (!joints.length || !links.length) throw new Error(`${name}: no links or joints found in the URDF`);
  return { name, root, links, joints };
}

/** Movable joints only, in file order. */
export function movableJoints(model: UrdfModel): UrdfJoint[] {
  return model.joints.filter((j) => MOVABLE.has(j.type));
}
