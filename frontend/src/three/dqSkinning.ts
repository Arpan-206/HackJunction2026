import { Matrix4, Quaternion, ShaderChunk, Vector3, type Skeleton, type SkinnedMesh } from 'three';

/**
 * Dual quaternion skinning for every skinned mesh in the app (only the hand is skinned).
 *
 * three.js blends bone matrices linearly, which shrinks a joint as it bends: at a curled finger's middle knuckle the
 * skin between two bones is averaged towards the bend's centre, so a fist loses the thickness of its fingers and
 * knuckles and reads as one soft lump. Blending the bones as unit dual quaternions instead keeps every blend a rigid
 * motion, so a bent joint keeps its cross-section and curled fingers keep their volume.
 *
 * The dual quaternions are made on the CPU, once per bone per frame (skinWithDualQuaternions replaces the skeleton update):
 * each bone's mesh-space transform (bindMatrixInverse * bone * bindMatrix) is rigid even for a mirrored or scaled hand,
 * as the mesh and its bones share every ancestor, and its rotation and translation go into the skeleton's bone texture
 * in place of the matrix. The vertex shader then only fetches and blends two vec4s per bone, cheaper than three.js's own
 * matrix blend, which matters on software renderers. Shadow depth passes and every material patch (outline hull, tints,
 * rim) read the same texture, so they all skin the same way.
 */

const PARS = /* glsl */ `
#ifdef USE_SKINNING

	uniform highp sampler2D boneTexture;

	// One bone's unit dual quaternion: real part (rotation, x y z w) and dual part, in the first two of its four texels.
	void getBoneDQ( const in float i, out vec4 real, out vec4 dual ) {

		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		real = texelFetch( boneTexture, ivec2( x, y ), 0 );
		dual = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );

	}

	vec3 dqRotate( const in vec4 r, const in vec3 v ) {

		return v + 2.0 * cross( r.xyz, cross( r.xyz, v ) + r.w * v );

	}

#endif
`;

const BASE = /* glsl */ `
#ifdef USE_SKINNING

	vec4 dqReal;
	vec4 dqDual;
	{
		vec4 rX, dX, rY, dY, rZ, dZ, rW, dW;
		getBoneDQ( skinIndex.x, rX, dX );
		getBoneDQ( skinIndex.y, rY, dY );
		getBoneDQ( skinIndex.z, rZ, dZ );
		getBoneDQ( skinIndex.w, rW, dW );
		// Sign-align every bone with the first, so the blend takes the short way round.
		float wY = dot( rX, rY ) < 0.0 ? - skinWeight.y : skinWeight.y;
		float wZ = dot( rX, rZ ) < 0.0 ? - skinWeight.z : skinWeight.z;
		float wW = dot( rX, rW ) < 0.0 ? - skinWeight.w : skinWeight.w;
		dqReal = rX * skinWeight.x + rY * wY + rZ * wZ + rW * wW;
		dqDual = dX * skinWeight.x + dY * wY + dZ * wZ + dW * wW;
		float len = max( length( dqReal ), 1e-6 );
		dqReal /= len;
		dqDual /= len;
	}

#endif
`;

const NORMAL = /* glsl */ `
#ifdef USE_SKINNING

	objectNormal = dqRotate( dqReal, objectNormal );

	#ifdef USE_TANGENT

		objectTangent = dqRotate( dqReal, objectTangent );

	#endif

#endif
`;

const POSITION = /* glsl */ `
#ifdef USE_SKINNING

	transformed = dqRotate( dqReal, transformed ) + 2.0 * ( dqReal.w * dqDual.xyz - dqDual.w * dqReal.xyz + cross( dqReal.xyz, dqDual.xyz ) );

#endif
`;

let installed = false;

/** Swaps three.js's linear blend skinning chunks for dual quaternion ones. Idempotent; call before any skinned draw. */
export function installDualQuaternionSkinning(): void {
  if (installed) return;
  installed = true;
  const chunks = ShaderChunk as Record<string, string>;
  chunks.skinning_pars_vertex = PARS;
  chunks.skinbase_vertex = BASE;
  chunks.skinnormal_vertex = NORMAL;
  chunks.skinning_vertex = POSITION;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _t = new Vector3();
const _s = new Vector3();

/**
 * Makes `skeleton` write dual quaternions into its bone texture instead of matrices, in the space of `mesh` (every
 * mesh bound to the skeleton must share that mesh's world transform and bind matrix, as the hand's fill, outline and
 * depth meshes do).
 */
export function skinWithDualQuaternions(skeleton: Skeleton, mesh: SkinnedMesh): void {
  skeleton.update = function update(this: Skeleton) {
    const out = this.boneMatrices;
    for (let i = 0; i < this.bones.length; i++) {
      _m.multiplyMatrices(mesh.bindMatrixInverse, this.bones[i].matrixWorld).multiply(this.boneInverses[i]).multiply(mesh.bindMatrix);
      _m.decompose(_t, _q, _s);
      const o = i * 16;
      out[o] = _q.x;
      out[o + 1] = _q.y;
      out[o + 2] = _q.z;
      out[o + 3] = _q.w;
      // Dual part: 0.5 * (t, 0) * q.
      out[o + 4] = 0.5 * (_t.x * _q.w + _t.y * _q.z - _t.z * _q.y);
      out[o + 5] = 0.5 * (-_t.x * _q.z + _t.y * _q.w + _t.z * _q.x);
      out[o + 6] = 0.5 * (_t.x * _q.y - _t.y * _q.x + _t.z * _q.w);
      out[o + 7] = -0.5 * (_t.x * _q.x + _t.y * _q.y + _t.z * _q.z);
    }
    if (this.boneTexture) this.boneTexture.needsUpdate = true;
  };
}

const _real = new Quaternion();
const _dual = new Quaternion();
const _v = new Vector3();
const _c = new Vector3();

/**
 * The CPU side of the same skinning for one mesh bound to a dual quaternion skeleton: three.js reads skinned vertex
 * positions on the CPU for the bounding sphere (transparent sorting) and for raycasts, and its own version would read
 * the bone texture's dual quaternions as matrices.
 */
export function applyDualQuaternionBoneTransform(mesh: SkinnedMesh): void {
  mesh.applyBoneTransform = function applyBoneTransform(this: SkinnedMesh, index: number, target: Vector3): Vector3 {
    const m = this.skeleton.boneMatrices;
    const si = this.geometry.attributes.skinIndex;
    const sw = this.geometry.attributes.skinWeight;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let rw = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let dw = 0;
    const o0 = si.getComponent(index, 0) * 16;
    for (let c = 0; c < 4; c++) {
      const w0 = sw.getComponent(index, c);
      if (w0 === 0) continue;
      const o = si.getComponent(index, c) * 16;
      // Sign-aligned with the first bone, as in the vertex shader.
      const w = m[o0] * m[o] + m[o0 + 1] * m[o + 1] + m[o0 + 2] * m[o + 2] + m[o0 + 3] * m[o + 3] < 0 ? -w0 : w0;
      rx += m[o] * w;
      ry += m[o + 1] * w;
      rz += m[o + 2] * w;
      rw += m[o + 3] * w;
      dx += m[o + 4] * w;
      dy += m[o + 5] * w;
      dz += m[o + 6] * w;
      dw += m[o + 7] * w;
    }
    const len = Math.max(Math.hypot(rx, ry, rz, rw), 1e-6);
    _real.set(rx / len, ry / len, rz / len, rw / len);
    _dual.set(dx / len, dy / len, dz / len, dw / len);
    // Translation 2 * (w_r * d - w_d * r + r x d), as in the vertex shader.
    _v.set(_real.x, _real.y, _real.z);
    _c.set(_dual.x, _dual.y, _dual.z);
    const tx = 2 * (_real.w * _c.x - _dual.w * _v.x + (_v.y * _c.z - _v.z * _c.y));
    const ty = 2 * (_real.w * _c.y - _dual.w * _v.y + (_v.z * _c.x - _v.x * _c.z));
    const tz = 2 * (_real.w * _c.z - _dual.w * _v.z + (_v.x * _c.y - _v.y * _c.x));
    return target.applyQuaternion(_real).add(_v.set(tx, ty, tz));
  };
}
