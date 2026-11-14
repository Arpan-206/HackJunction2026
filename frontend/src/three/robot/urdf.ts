/**
 * A small URDF reader for the robot twin. It keeps what drawing needs and what core/robot.py reads: each movable joint's
 * origin, axis, limits and links, and each link's centre of mass (used to guess where a fingertip ends, because the STL
 * meshes are not shipped). The parse is a tiny tag scanner, not a general XML parser, so it runs the same in the
 * browser and in vitest's node environment without DOMParser.
 */

export type Vec3 = [number, number, number];

export interface UrdfJoint {
  name: string;
  type: string;
  parent: string;
  child: string;
  /** Joint frame position in the parent link frame, metres. */
  xyz: Vec3;
  /** Fixed roll, pitch, yaw of the joint frame, radians. */
  rpy: Vec3;
  /** Rotation axis in the joint frame (unit length as written in the file). */
  axis: Vec3;
  lower: number;
  upper: number;
}

export interface UrdfLink {
  name: string;
  /** Centre of mass in the link frame, metres, or null when the link has no inertial block. */
  com: Vec3 | null;
}

export interface UrdfModel {
  name: string;
  /** The link no joint names as its child. */
  root: string;
  links: Record<string, UrdfLink>;
  /** Movable joints only (revolute, prismatic, continuous), in file order, as core/robot.py keeps them. */
  joints: UrdfJoint[];
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  children: Tag[];
}

const MOVABLE = new Set(['revolute', 'prismatic', 'continuous']);

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = m[3] ?? m[4] ?? '';
  return out;
}

/** Turns XML text into a tag tree. Comments, declarations and text nodes are dropped. */
export function parseXml(text: string): Tag {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const root: Tag = { name: '#root', attrs: {}, children: [] };
  const stack: Tag[] = [root];
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const [, closing, name, attrs, selfClosing] = m;
    if (closing) {
      while (stack.length > 1) {
        const top = stack.pop() as Tag;
        if (top.name === name) break;
      }
      continue;
    }
    const tag: Tag = { name, attrs: parseAttrs(attrs), children: [] };
    stack[stack.length - 1].children.push(tag);
    if (!selfClosing) stack.push(tag);
  }
  return root;
}

const child = (t: Tag, name: string): Tag | undefined => t.children.find((c) => c.name === name);

function vec(src: string | undefined, fallback: Vec3): Vec3 {
  if (!src) return fallback;
  const v = src.trim().split(/\s+/).map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? (v as Vec3) : fallback;
}

/** Parses URDF text. Throws when the file holds no robot or no movable joint, as core/robot.py does. */
export function parseUrdf(text: string): UrdfModel {
  const doc = parseXml(text);
  const robot = child(doc, 'robot');
  if (!robot) throw new Error('not a URDF: no <robot> element');
  const links: Record<string, UrdfLink> = {};
  for (const l of robot.children.filter((c) => c.name === 'link')) {
    const inertial = child(l, 'inertial');
    const origin = inertial && child(inertial, 'origin');
    links[l.attrs.name] = { name: l.attrs.name, com: origin ? vec(origin.attrs.xyz, [0, 0, 0]) : null };
  }
  const joints: UrdfJoint[] = [];
  const children = new Set<string>();
  for (const j of robot.children.filter((c) => c.name === 'joint')) {
    const type = j.attrs.type ?? 'revolute';
    const childLink = child(j, 'child')?.attrs.link ?? '';
    if (childLink) children.add(childLink);
    if (!MOVABLE.has(type)) continue;
    const origin = child(j, 'origin');
    const limit = child(j, 'limit');
    joints.push({
      name: j.attrs.name,
      type,
      parent: child(j, 'parent')?.attrs.link ?? '',
      child: childLink,
      xyz: vec(origin?.attrs.xyz, [0, 0, 0]),
      rpy: vec(origin?.attrs.rpy, [0, 0, 0]),
      axis: vec(child(j, 'axis')?.attrs.xyz, [0, 0, 1]),
      lower: limit ? Number(limit.attrs.lower ?? -Math.PI) : -Math.PI,
      upper: limit ? Number(limit.attrs.upper ?? Math.PI) : Math.PI,
    });
  }
  if (!joints.length) throw new Error(`${robot.attrs.name ?? 'URDF'}: no movable joints found`);
  const root = Object.keys(links).find((n) => !children.has(n)) ?? joints[0].parent;
  return { name: robot.attrs.name ?? 'robot', root, links, joints };
}

/** The joint by name, or undefined. */
export function jointByName(model: UrdfModel, name: string): UrdfJoint | undefined {
  return model.joints.find((j) => j.name === name);
}
