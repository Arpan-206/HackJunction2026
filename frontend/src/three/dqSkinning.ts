import { ShaderChunk } from 'three';

/**
 * Dual quaternion skinning for every skinned mesh in the app (only the hand is skinned).
 *
 * three.js blends bone matrices linearly, which shrinks a joint as it bends: at a curled finger's middle knuckle the
 * skin between two bones is averaged towards the bend's centre, so a fist loses the thickness of its fingers and
 * knuckles and reads as one soft lump. Blending the bones as unit dual quaternions instead keeps every blend a rigid
 * motion, so a bent joint keeps its cross-section and curled fingers keep their volume.
 *
 * Each bone's mesh-space transform (bindMatrixInverse * bone * bindMatrix) is rigid even for a mirrored left hand, as
 * the mesh and its bones share the mirror; it is turned into a dual quaternion in the vertex shader, so shadow depth
 * passes and every material patch (outline hull, tints, rim) skin the same way with no extra uniforms.
 */

const PARS = /* glsl */ `
#ifdef USE_SKINNING

	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;

	uniform highp sampler2D boneTexture;

	mat4 getBoneMatrix( const in float i ) {

		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );

		return mat4( v1, v2, v3, v4 );

	}

	// Rotation of a rigid matrix as a unit quaternion (x, y, z, w). GLSL matrices are column major: m[ col ][ row ].
	vec4 dqRotation( const in mat4 m ) {

		float t = m[ 0 ][ 0 ] + m[ 1 ][ 1 ] + m[ 2 ][ 2 ];
		vec4 q;
		if ( t > 0.0 ) {
			float s = sqrt( t + 1.0 ) * 2.0;
			q = vec4( m[ 1 ][ 2 ] - m[ 2 ][ 1 ], m[ 2 ][ 0 ] - m[ 0 ][ 2 ], m[ 0 ][ 1 ] - m[ 1 ][ 0 ], 0.25 * s * s ) / s;
		} else if ( m[ 0 ][ 0 ] > m[ 1 ][ 1 ] && m[ 0 ][ 0 ] > m[ 2 ][ 2 ] ) {
			float s = sqrt( 1.0 + m[ 0 ][ 0 ] - m[ 1 ][ 1 ] - m[ 2 ][ 2 ] ) * 2.0;
			q = vec4( 0.25 * s * s, m[ 1 ][ 0 ] + m[ 0 ][ 1 ], m[ 2 ][ 0 ] + m[ 0 ][ 2 ], m[ 1 ][ 2 ] - m[ 2 ][ 1 ] ) / s;
		} else if ( m[ 1 ][ 1 ] > m[ 2 ][ 2 ] ) {
			float s = sqrt( 1.0 + m[ 1 ][ 1 ] - m[ 0 ][ 0 ] - m[ 2 ][ 2 ] ) * 2.0;
			q = vec4( m[ 1 ][ 0 ] + m[ 0 ][ 1 ], 0.25 * s * s, m[ 2 ][ 1 ] + m[ 1 ][ 2 ], m[ 2 ][ 0 ] - m[ 0 ][ 2 ] ) / s;
		} else {
			float s = sqrt( 1.0 + m[ 2 ][ 2 ] - m[ 0 ][ 0 ] - m[ 1 ][ 1 ] ) * 2.0;
			q = vec4( m[ 2 ][ 0 ] + m[ 0 ][ 2 ], m[ 2 ][ 1 ] + m[ 1 ][ 2 ], 0.25 * s * s, m[ 0 ][ 1 ] - m[ 1 ][ 0 ] ) / s;
		}
		return normalize( q );

	}

	vec4 dqMul( const in vec4 a, const in vec4 b ) {

		return vec4( a.w * b.xyz + b.w * a.xyz + cross( a.xyz, b.xyz ), a.w * b.w - dot( a.xyz, b.xyz ) );

	}

	// Adds one bone to the blend: its rotation r and dual part 0.5 * t * r, sign-aligned with the first bone.
	void dqAccumulate( const in mat4 bone, const in float w, const in vec4 pivot, inout vec4 real, inout vec4 dual ) {

		mat4 m = bindMatrixInverse * bone * bindMatrix;
		vec4 r = dqRotation( m );
		vec4 d = 0.5 * dqMul( vec4( m[ 3 ].xyz, 0.0 ), r );
		float s = dot( r, pivot ) < 0.0 ? - w : w;
		real += r * s;
		dual += d * s;

	}

	vec3 dqRotate( const in vec4 r, const in vec3 v ) {

		return v + 2.0 * cross( r.xyz, cross( r.xyz, v ) + r.w * v );

	}

#endif
`;

const BASE = /* glsl */ `
#ifdef USE_SKINNING

	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );

	vec4 dqReal = vec4( 0.0 );
	vec4 dqDual = vec4( 0.0 );
	{
		vec4 pivot = dqRotation( bindMatrixInverse * boneMatX * bindMatrix );
		dqAccumulate( boneMatX, skinWeight.x, pivot, dqReal, dqDual );
		dqAccumulate( boneMatY, skinWeight.y, pivot, dqReal, dqDual );
		dqAccumulate( boneMatZ, skinWeight.z, pivot, dqReal, dqDual );
		dqAccumulate( boneMatW, skinWeight.w, pivot, dqReal, dqDual );
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
