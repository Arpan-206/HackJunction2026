# Capture every glove stream with each lesson (design only)

Status: proposal. Nothing here is implemented. The changes land in the teammate's `core/` and `config.toml`, which this
branch must not edit, so they need the core owner's approval first.

## Why

A lesson today keeps only what the scorer needs: `trace.npz` holds `t_us`, `angles` (18), `joints` (26 x 3), `wrist_p`,
`wrist_q` and `step` (`core/recorder.py`, `Trace.save`). Everything the gloves measured below the solver is thrown away:
the raw sensor orientations, gyro, accelerometer, status flags and the driver's `emf_only` group. That loses:

- the evidence to tune or replace the solver later (finger isolation, the uneven spread of flexion over joints noted in
  `docs/HARDWARE_INTEGRATION.md`);
- saturation and heading reliability during the take (a take recorded next to a laptop cannot be told apart later);
- stillness from the gyro (|gyro| < 0.05 rad/s for 500 ms is the real hardware's stillness test), which would make the
  automatic step cuts in `Recorder` (`still_deg_s`, `still_min_ms`) more reliable than joint speed alone.

## What the streams are (measured on Smartgloves II, driver 1.9.7)

Driver RGMP, `127.0.0.1:12276`, per glove, two groups at 83.3 Hz each:

| group | streams | content |
| --- | --- | --- |
| `default` | 31 | per sensor (`thumb`, `index`, `middle`, `ring`, `little` finger sensors, `arm_sensor`, `hub`): `TRANSFORM` (orientation relative to `hub`; `arm_sensor` relative to `coil_pro`), `ANGULAR_VELOCITY` (rad/s), `PROPER_ACCELERATION` (g), `STATUS_FLAGS` (bit names in each stream's `bit_mapping`); hub `ORIENTATION` |
| `emf_only` | 18 | EMF readings and their `STATUS_FLAGS` |

Solver RGMP, `127.0.0.1:12277`: `joints_openxr` and `joints_local` per hand (26 joints), no status flags. Data on 12276
flows only while some RCSP client holds `SubscribeToData` for the glove; the core does that through `GloveControl`.

## Proposed change

Keep the core's live path exactly as it is. Add a second, passive RGMP reader on the driver port and store what it reads
next to the trace, cut to the same recording window.

1. `core/rgmp.py`: a new `RawDriverTap` class, beside `GloveSource`. It connects to `[glove].raw_port` (12276, already in
   `config.toml`), reuses `RgmpParser`, and keeps a bounded ring buffer of `(arrival_us, device_id, group_index,
   device_timestamp_us, payload bytes)` plus the latest `DeviceDefinition` per device. It never sends anything and never
   subscribes (the core's `GloveControl` already does). Clock mapping reuses `ClockMapper`, so `t_us` lines up with the
   trace's clock.
2. `core/recorder.py`:
   - `Recorder.start(...)` records `t_start_us` (it already does) and asks the tap to mark the start.
   - `Recorder.stop(...)` takes the tap's frames between start and stop and hands them to a new `RawStreams` object.
   - New `RawStreams.save(dir)` writes `raw_driver.npz` with, per device: `t_us` (int64), `group` (int8), and one array per
     measure type, named `<sensor>__<measure>` (for example `index__angular_velocity`, float32, N x 3;
     `hub__status_flags`, uint32, N), decoded with the definition so no bit positions are baked in; plus
     `definition_<device_id>.json` verbatim. Optionally `raw_driver.rgmp.gz`, the untouched bytes, for exact replay.
   - `Lesson.save()` calls `RawStreams.save()` when present; `Lesson.load(with_trace=True)` leaves raw streams unloaded
     unless asked (`with_raw=False` default), so the scorer stays as fast as today.
   - `trace.npz` gains two optional arrays: `heading_reliable` (bool per sample, from the hub flag of the master's glove)
     and `saturated` (uint8 bitmask per sample: accelerometer, gyroscope, magnetometer, EMF). Old lessons without them
     still load.
3. `core/__main__.py`: one flag, `--raw-capture/--no-raw-capture` (default from config), and the tap started next to
   `GloveSource` when gloves are the source.
4. `config.toml`, new section:

   ```toml
   [record.raw]
   enabled = true
   keep_bytes = false        # also keep raw_driver.rgmp.gz (about 2 MB per glove per minute, gzip)
   buffer_s = 600            # ring buffer length on the driver tap
   groups = ["default", "emf_only"]
   ```

5. `core/schema.py`: lesson summary gains `raw_streams: bool`, so the app can tell which lessons carry them.

## Size

About 1.1 kB per frame per glove for `default` and 0.6 kB for `emf_only` as decoded float32, so roughly 140 kB/s per
glove before compression; `np.savez_compressed` brings a one minute two-glove take to about 10 MB. Keeping the raw bytes
gzip'd adds about 2 MB per glove per minute (the trimmed fixtures in `backend/tests/fixtures/rgmp/` compress at a similar
ratio).

## Tests (in the core's own suite)

- Replay `backend/tests/fixtures/rgmp/worn_driver.rgmp.gz` and `worn_solver.rgmp.gz` together through `GloveSource` and
  `RawDriverTap` with a fake clock, record a take, and check that `raw_driver.npz` covers the same window as `trace.npz`
  (first and last `t_us` within one frame), has 49 streams per glove, and decodes flags by name.
- A lesson saved without the tap loads and scores exactly as before.

## Open questions for the core owner

- Should the master's raw streams be kept only for the master's hand, or both hands (both is simpler and cheap)?
- Is a second reader on 12276 acceptable in production? The driver serves many readers, and the backend's glove status
  already reads it the same way.
- `arm_sensor` is relative to `coil_pro`, which this rig does not have; store it as is and mark it, or drop it.
