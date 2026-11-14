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

/* ---- Real gloves (docs/CONTRACT.md "Real gloves"); the mock router's answers are checked against these in tests ---- */

const side = z.enum(['left', 'right']);

export const gloveRigStatusSchema = z.object({
  checked_at: z.string(),
  source: z.enum(['simulator', 'rokoko_udp', 'rokoko_sdk', 'external']),
  ready: z.boolean(),
  driver: z.object({
    driver_running: z.boolean(),
    driver_port_open: z.boolean(),
    solver_running: z.boolean(),
    solver_port_open: z.boolean(),
    rcsp_connected: z.boolean(),
    studio_running: z.boolean(),
    managed: z.boolean(),
    autostart: z.boolean(),
    sdk_found: z.boolean(),
    last_error: z.string().nullable(),
  }),
  gloves: z
    .array(
      z.object({
        side,
        connected: z.boolean(),
        device_id: z.number().nullable(),
        connection: z.enum(['usb', 'wifi', 'emulated', 'unknown']).nullable(),
        fps: z.number().nullable(),
        driver_fps: z.number().nullable(),
        streaming: z.boolean().nullable(),
        last_frame_age_ms: z.number().nullable(),
        battery_pct: z.number().nullable(),
        heading_reliable: z.boolean().nullable(),
        sensors: z.array(z.object({ name: z.enum(['thumb', 'index', 'middle', 'ring', 'little', 'arm', 'hub']), saturated: z.array(z.string()) })),
      }),
    )
    .length(2),
  issues: z.array(
    z.object({
      code: z.enum(['studio_running', 'device_busy', 'driver_not_running', 'solver_not_running', 'no_usb_devices', 'glove_missing', 'not_streaming', 'no_frames', 'low_frame_rate', 'saturation', 'heading_unreliable']),
      side: side.nullable(),
      blocking: z.boolean(),
      title: z.string(),
      fix: z.string(),
    }),
  ),
});

export const wearerCalibrationSchema = z.object({
  id: z.string(),
  wearer: z.string().min(1).max(40),
  created_at: z.string(),
  neutral: z.array(z.object({ side, offsets: z.record(finger, triple), yaw_zero_deg: z.number(), noise_deg: z.number(), yaw_spread_deg: z.number(), frames: z.number() })),
  range_calibration_ids: z.object({ left: z.string().optional(), right: z.string().optional() }),
  quality: z.object({
    noise_deg: z.number().nullable(),
    bias_deg: z.number().nullable(),
    heading_reliable: z.number().nullable(),
    grade: z.enum(['good', 'fair', 'poor']),
    notes: z.array(z.string()),
  }),
  reinit: z.boolean(),
  verified: z.boolean(),
});

export const driftCheckResultSchema = z.object({
  ok: z.boolean(),
  calibration_id: z.string(),
  hands: z.array(z.object({ side, flex_drift_deg: z.number(), yaw_drift_deg: z.number() })),
  max_flex_deg: z.number(),
  max_yaw_deg: z.number(),
  message: z.string(),
});
