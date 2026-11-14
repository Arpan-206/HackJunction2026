# ML and positioning pipeline: interface spec

For the teammate building the ML and positioning work. The goal is to add models without changing the frontend contract more than necessary. The source of truth for types is `docs/CONTRACT.md` (backend `backend/app/schemas/`, frontend `frontend/src/api/types.ts`).

## 1. What a recording looks like

```
Recording {
  id, lesson_id, step_id, started_at, duration_s, fps,
  frames: GloveFrame[]    // smoothed (One Euro) frames as streamed
}
GloveFrame { t, source, hands: HandFrame[] }          // t in seconds since stream start
HandFrame  { side, wrist_quat[x,y,z,w], wrist_pos | null,
             flexion: {thumb,index,middle,ring,little: [j1,j2,j3]},   // radians, 0 straight, positive curled
             spread?: {...} }
```
Units: seconds, radians, metres. Rate about 60 Hz (simulator 60; Rokoko about 60 to 83). Frames are post-smoothing, so tremor is already reduced; raw frames are not stored. `wrist_pos` is null from gloves alone.

**Labels.** Each recording is tagged by the step it was recorded for:
- `lesson_id`: the lesson.
- `step_id`: the convention `"<move_id>:rep<n>"` when recorded via "Start from scratch" (for example `free_k3x9q2ab:rep2`) or against a catalogue move (`tt_forehand_swing:rep2`). Parse with `move_id, rep = step_id.rsplit(":rep", 1)`.
- `move_id` is a `MoveKind.id` from `GET /api/moves` (catalogue in `backend/app/data/moves.json`), or, for a new skill recorded from scratch, a free move id `free_<8 letters and digits>` fixed before the first take (the name the expert gives the move on Publish is the step title, not part of the label, so renaming never relabels takes). Each rep is one labelled example. Free-text or generated lessons have step ids assigned by the server, so check for the `:rep` pattern before relying on it.
- Master takes are the "good" class. Learner attempts are recorded the same way against the learner's lesson; treat them as unlabelled for quality (no ground truth) unless the master rates them.

## 2. Where to read them

- Disk: `DATA_DIR/recordings/*.json` (default `backend/data/recordings/`; `DATA_DIR` env var overrides, see `app/core/config.py`, store implemented in `app/services/storage/json_store.py`). One JSON file per recording, schema = `Recording`. Calibrations in `DATA_DIR/calibrations/`, lessons in `DATA_DIR/lessons/`.
- API: `GET /api/recordings/{id}` returns a `Recording`. There is no list endpoint yet (propose below).
- Live: WebSocket `/ws/gloves` for real-time inference.
- Per-user normalisation: load the matching `Calibration` (`GET /api/calibrations/latest?side=`) and map flexion from `[flat, fist]` to `[0, 1]` per joint. Both phases are required: an uncaptured phase is returned as zeros, so `fist - flat` can be 0 and you would divide by zero. Check both phases are non-zero and guard the denominator. The production scorer applies this normalisation when the request sets `use_latest_calibration` or a calibration id (`scoring.py`), so reuse the same mapping for consistency.
- Apprentice attempts may be scored with inline `attempt_frames` sent to `POST /score` and never stored as recordings. Do not assume every attempt exists under `DATA_DIR/recordings`; ask the frontend owner to store them if you need them as training data.

Minimal Python loader:
```
import json, pathlib
rec = json.loads(pathlib.Path("backend/data/recordings/<id>.json").read_text())
X = [[j for f in ("thumb","index","middle","ring","little") for j in h["flexion"][f]]
     for fr in rec["frames"] for h in fr["hands"][:1]]     # 15 features per hand
```

## 3. Suggested features

Per hand per frame (15 flexion plus optional 5 spread plus 4 quaternion). Derived:
- Joint velocity and acceleration (finite difference on smoothed signal, window 3 to 5).
- Fingertip flexion sums per finger.
- Wrist angular velocity from quaternion difference (`q_t * conj(q_{t-1})`).
- Per-user normalised flexion (calibration).
- Resample to a fixed length (for example 100 steps) for model input, or use DTW (the research recommends `dtaidistance dtw_ndim` with a window, research/02).
Windows: 1 to 2 s with 50 percent overlap for classification.

## 4. Suggested models and outputs

| Task | Input | Output | Baseline |
|---|---|---|---|
| Move classification | window of features | `{move_id, confidence}` | kNN with DTW, or a small 1D CNN / GRU; few samples per class so start with DTW kNN |
| Quality score | attempt vs reference | 0 to 100 plus per-finger | existing scoring in `app/services/scoring.py`; ML only to calibrate it against master ratings |
| Segmentation | stream | step or repetition boundaries | threshold on velocity energy |
| Wrist position from MediaPipe fusion | webcam frame + glove frames | `wrist_pos` in metres (table frame) | MediaPipe wrist landmark + scale for depth (`POST /vision/hands`, normalised image coordinates), fuse with the glove quaternion, smooth with a Kalman or One Euro |
| Anomaly | window | in-distribution flag | distance to the master's takes |

Wrist fusion notes (research/03): MediaPipe Hands reportedly fails on dark gloves; the wrist landmark from MediaPipe Pose may be more robust, or use an ArUco marker on the hub with OpenCV solvePnP. Output into `HandFrame.wrist_pos` (metres) so the frontend already supports it.

## 5. How results flow back (proposed endpoints)

These do not exist yet; add them under `backend/app/api/routes/` with schemas in `app/schemas/`, and mirror in the contract and `types.ts` in one commit.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/recordings?lesson_id=&move_id=` | | `RecordingSummary[]` (id, lesson_id, step_id, duration_s, started_at) so training sets can be enumerated |
| POST | `/ml/classify` | `{recording_id or frames}` | `{move_id, confidence, top_k: [{move_id, p}]}` |
| POST | `/ml/quality` | `{reference_recording_id, attempt_recording_id}` | `{score, per_finger, per_joint, timing_ms, model_version}` (plugs into `ScoreResult`; keep `overall`, `per_finger`, `timing`) |
| POST | `/ml/position` | `{recording_id, video_url?}` | `{frames: [{t, side, wrist_pos}]}` written back into the recording |
| WS | `/ws/ml` | stream frames | live `{t, move_id, confidence}` events |
| GET | `/ml/models` | | `[{name, version, task, trained_on}]` |

Rules:
- Every result carries `model_version` and returns within 500 ms for live use.
- Failures return `{detail}` with 503 so the UI falls back to the algorithmic score (routes stay thin, ARCHITECTURE rules).
- Output enums must match contract names (`Finger`, `Side`, `move_id`).
- Do not mutate a recording in place; write positions to a sibling file `<id>.position.json` or create a new version.

## 6. Training data reality

- Few examples (3 to 5 takes per move), few moves. Prefer few-shot methods and DTW over deep nets. Use the simulator (`POST /motion/preview`, `MotionSpec`) for augmentation, but flag synthetic data in the dataset.
- Collect negative examples deliberately: ask a teammate to do each move wrongly, and label by hand.
- Hold out one wearer for evaluation to catch hand-size overfitting.

## 7. Open questions for the teammate

- Which task first: classification (useful for auto-splitting) or quality (useful for the headline score)?
- Is wrist position needed for the demo, or only for the video overlay?
- Where will the model run (backend process or separate service)?
