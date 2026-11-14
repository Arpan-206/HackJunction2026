# STATUS: lane arkit-app

Branch `arkit-app`, folder `ios/`. Written Sat 14 Nov 2026.

**BLOCKED at signing.** The app needs Arpan's Apple ID to install on the phone. Follow `ios/README.md`, section "Put the app on the iPhone". Signing was not attempted, as the brief says.

## What works, and how to run it

| Item | Result | Command |
| --- | --- | --- |
| Xcode | Xcode 26.5 (17F42), iOS SDK 26.5 | `xcodebuild -version` |
| App build, generic iOS device, no signing | BUILD SUCCEEDED, no warnings from our code | `cd ios/GeppettoDepth && xcodebuild build -project GeppettoDepth.xcodeproj -scheme GeppettoDepth -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO` |
| Built Info.plist | camera and local-network strings, `arkit` capability, landscape-right only, iOS 16.0 minimum | checked with `plutil -p` |
| Mac tests | 11 passed | `python -m pytest -q ios/mac/tests` (repo root, `.venv`) |
| libimobiledevice | installed by this lane with `brew install libimobiledevice` (1.4.0, libusbmuxd 2.1.1) | `iproxy --help` |
| Phone on USB | seen: iPhone 16 Pro (iPhone17,1), iOS 27.0.1, paired | `idevice_id -l`, `xcrun devicectl list devices` |

The tests cover:

- the byte layout against `PROTOCOL.md`;
- float16 to float32 decoding, and K scaled from the camera size to the JPEG size;
- the plane and confidence flags;
- resync after a stream joined mid-packet and after a bogus length;
- fake-scene geometry: a back-projected table pixel lands on world y = 0, a hand pixel 0.10 m above;
- the committed recording read as `DepthFrame`s;
- replay served on a port, read by the live reader, and recorded again byte for byte;
- the live camera class: status and newest frame.

The recorded session `ios/mac/tests/fixtures/FAKE_sender_session.gdrec.gz` comes from `ios/mac/fake_sender.py` over TCP. It is synthetic, not a phone capture. Its note in the file says so.

## Written but untested (needs the phone)

- The whole Swift runtime path: the ARKit session, float16 conversion with vImage, the JPEG encode, the NWListener over usbmux, the send rate and frame skipping, the depth preview.
- `ios/mac/forward.sh` with the app running. Today, `idevice_id` sees the phone, but no app listens yet.
- The table plane pose. The order "anchor transform, then centre, then `rotationOnYAxis`" follows the ARKit header text. The sign of the rotation is unchecked.
- The real send rate. The budget is about 190 KB per frame (98 KB depth, 49 KB confidence, about 40 KB JPEG), so about 5.7 MB/s at 30 Hz. USB should carry it; not measured.
- Xcode 26.5 with a phone on iOS 27.0.1. Xcode may ask for device support files or a newer Xcode. See the last row of the problems table in `ios/README.md`.

## Choices made (no questions asked)

| Choice | Why |
| --- | --- |
| Port 7700 on the phone and the Mac | Free, and far from the core's 8765 and PathOn's 8888 |
| Framing: magic `GDP1`, u32 length, fixed 216-byte header, then depth, confidence, JPEG | Length prefix as the brief asks; the magic lets the reader resync like the PathOn reader |
| K sent at the full camera size (1920 x 1440), scaled on the Mac | The phone sends ARKit values unchanged; `DepthFrame.K` still ends at the colour size |
| Camera pose sent in ARKit axes; `opencv_pose()` converts | Same as ARKit gives it, so nothing is lost; one documented helper for OpenCV users |
| Images kept in sensor orientation; app locked to landscape right | Depth, colour and K then agree with no rotation |
| `sceneDepth`, not `smoothedSceneDepth` | Hands move; temporal smoothing blurs them |
| Largest horizontal plane by area | As the brief says. Risk: on a small bench the floor may be larger. If so, pick the highest plane in view instead |
| One client, one packet in flight, skip when busy | A slow reader gets fresh frames, never a backlog |
| Xcode project hand-written with a synchronized folder (objectVersion 77) | No XcodeGen or other tools; new Swift files in the folder join the target on their own |
| Bundle id `fi.junction.geppetto.depth`, no team | Arpan picks his team; the README says how to change the id if it is taken |
| Recording keeps raw packets plus arrival time | Replay feeds the reader the same bytes; `.gz` keeps fixtures small (35 KB for 12 frames) |
| Tests load `core/camera/depth.py` from the main checkout when it is missing | It is not on `origin/main` yet. `ios/mac/tests/conftest.py` loads it read-only by path; once it is on main, the shim does nothing |

## What a human must do next

1. **Install the app.** Arpan: follow `ios/README.md`, "Put the app on the iPhone" (open, pick the team, Run). Turn on Developer Mode on the phone first.
2. **First live check.** Run `ios/mac/forward.sh`. Then run `python -m ios.mac.record captures/bench.gdrec.gz --seconds 10` and `python -m ios.mac.replay captures/bench.gdrec.gz --info`. Expect about 30 fps, depth `[256, 192]`, rgb `[640, 480]` and `with_plane` above 0 after a few seconds.
3. **Commit `core/camera/depth.py`** (and `record3dstream.py`) to main. The reader imports `core.camera.depth`. It only runs from a checkout that has that file.
4. **Config patch for the core owner** (not applied; `config.toml` belongs to the core). Add this beside `[camera.record3dstream]`, so `GeppettoDepthCamera.from_config(cfg, clock)` works:

```toml
[camera.geppetto_depth]
# Our own iPhone app (ios/GeppettoDepth) over the USB cable. Run ios/mac/forward.sh first.
host = "127.0.0.1"
port = 7700
timeout_s = 5.0
min_confidence = 1
```

5. **Wire it into the core** (core owner's call): build the source with `GeppettoDepthCamera.from_config(cfg, clock)` in the same place a `Record3DStreamCamera` is built. Neither source is wired into the core today; only `tools/r3d_snapshot.py` uses the PathOn reader.

No INTERFACE change was needed: `DepthFrame` already has every field this app sends. The plane extent (metres along the plane's x and z) is in the wire header but not in `DepthFrame`. Hand tracking can live without it.
