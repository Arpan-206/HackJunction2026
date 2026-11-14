import { z } from 'zod';

/** Opt-in runtime validators for untrusted payloads (replayed files, LLM drafts). Not run on the 60 Hz stream. */

const triple = z.tuple([z.number(), z.number(), z.number()]);
const finger = z.enum(['thumb', 'index', 'middle', 'ring', 'little']);

export const handFrameSchema = z.object({
  side: z.enum(['left', 'right']),
  wrist_quat: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  wrist_pos: triple.nullable(),
  flexion: z.record(finger, triple),
  spread: z.record(finger, z.number()).optional(),
});

export const gloveFrameSchema = z.object({
  t: z.number(),
  source: z.enum(['simulator', 'rokoko_udp', 'rokoko_sdk', 'replay']),
  hands: z.array(handFrameSchema),
});

/** The learner's margin of error (see src/api/margin.ts). */
export const marginSchema = z.enum(['strict', 'standard', 'relaxed', 'just_trying']);
const keyframeSchema = z.object({ pose: z.record(finger, z.number()), ms: z.number().positive(), yaw: z.number().optional(), pitch: z.number().optional(), roll: z.number().optional() });

export const motionSpecSchema = z.discriminatedUnion('preset', [
  z.object({ preset: z.literal('finger_sequence'), sequence: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])), beat_ms: z.number() }),
  z.object({ preset: z.literal('grip_and_swing'), grip: z.enum(['shakehand', 'penhold']), swing: z.enum(['forehand', 'backhand']), beat_ms: z.number() }),
  z.object({ preset: z.literal('pinch'), fingers: z.array(z.union([z.literal(2), z.literal(3)])), beat_ms: z.number() }),
  z.object({ preset: z.literal('hold_pose'), pose: z.record(finger, z.number()), left_pose: z.record(finger, z.number()).nullish() }),
  z.object({ preset: z.literal('keyframes'), keys: z.array(keyframeSchema).min(1), left_keys: z.array(keyframeSchema).min(1).nullish() }),
  z.object({ preset: z.literal('idle') }),
]);
