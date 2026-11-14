# Geppetto Depth: iPhone LiDAR to the Mac over USB

Geppetto Depth is a small iPhone app. It streams LiDAR depth to the Mac through the USB cable. The core uses the depth for hand tracking on a workbench. LiDAR is the depth sensor on Pro iPhones and iPads.

The app sends each frame at up to 30 Hz:

- the depth map (256 x 192, float16 metres) and its confidence map;
- a JPEG of the colour image (640 x 480);
- the camera intrinsics, the camera pose and the timestamp;
- the pose and size of the largest horizontal plane (the table).

The byte layout is in [PROTOCOL.md](PROTOCOL.md). The Mac reader gives the same `DepthFrame` as the PathOn reader (`core/camera/depth.py`), with `source = "geppetto-depth"`.

## Folders

| Path | What |
| --- | --- |
| `GeppettoDepth/GeppettoDepth.xcodeproj` | Xcode project (no packages, no signing team set) |
| `GeppettoDepth/GeppettoDepth/` | Swift sources: `DepthStreamer` (ARKit), `PacketEncoder` (wire format), `FrameServer` (TCP listener), `ContentView` |
| `GeppettoDepth/Info.plist` | camera and local-network usage strings, `arkit` capability |
| `mac/forward.sh` | forwards the phone port to the Mac over USB with `iproxy` |
| `mac/geppetto_depth.py` | reader: `parse_packet`, `PacketReader`, `GeppettoDepthCamera` (a `DepthSource`) |
| `mac/record.py`, `mac/replay.py` | recorder and replay (`.gdrec`, `.gdrec.gz`) |
| `mac/fake_sender.py` | a FAKE phone with a synthetic scene, for tests without an iPhone |
| `mac/tests/` | tests; `fixtures/FAKE_sender_session.gdrec.gz` is a fake recording, not a phone capture |

## Put the app on the iPhone (needs your Apple ID)

You need a Mac with Xcode, an iPhone with LiDAR (12 Pro or later) and a USB cable.

1. Open `ios/GeppettoDepth/GeppettoDepth.xcodeproj` in Xcode.
2. Click the blue **GeppettoDepth** project in the left column. Select the **GeppettoDepth** target. Open **Signing & Capabilities**.
3. Keep **Automatically manage signing** on. In **Team**, pick your Apple ID team. If no team shows, click **Add Account** and sign in.
4. If Xcode says the bundle identifier is not available, change `fi.junction.geppetto.depth` to something unique, for example `fi.junction.geppetto.depth.arpan`.
5. Plug in the iPhone. Unlock it. Tap **Trust** if the phone asks.
6. On the phone, turn on **Settings > Privacy & Security > Developer Mode**. The phone restarts. Confirm after the restart.
7. In the Xcode toolbar, pick the iPhone as the run destination. Press **Run** (Cmd-R).
8. With a free Apple ID, the first launch fails with "Untrusted Developer". On the phone, open **Settings > General > VPN & Device Management**, tap your Apple ID, then tap **Trust**. Press Run again.
9. On the phone, allow camera access. Allow local network access if the phone asks.

The app shows the depth preview (near is bright), the camera and send rates, the tracking state, the table plane and "waiting for the Mac on port 7700". Hold the phone in landscape with the camera on the left side, or mount it above the bench looking down.

A free Apple ID signs the app for 7 days. After that, press Run again.

## Reinstall from the terminal (after the first Xcode run)

Once Xcode has signed the app once, later builds can go on the phone without Xcode's
window. The team id is read from the app Xcode built. Keep the phone unlocked.

```
APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/GeppettoDepth-*/Build/Products/Debug-iphoneos/GeppettoDepth.app | head -1)
TEAM=$(codesign -dv "$APP" 2>&1 | grep TeamIdentifier | cut -d= -f2)
DEV=$(xcrun devicectl list devices | grep -i iphone | grep -o '[0-9A-F]\{8\}-[0-9A-F]\{4\}-[0-9A-F]\{4\}-[0-9A-F]\{4\}-[0-9A-F]\{12\}')
UDID=$(idevice_id -l | head -1)
xcodebuild -project ios/GeppettoDepth/GeppettoDepth.xcodeproj -scheme GeppettoDepth \
  -destination "id=$UDID" -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" -derivedDataPath /tmp/gdd build
xcrun devicectl device install app --device "$DEV" /tmp/gdd/Build/Products/Debug-iphoneos/GeppettoDepth.app
xcrun devicectl device process launch --device "$DEV" fi.junction.geppetto.depth
```

`xcodebuild` takes the USB serial (`idevice_id -l`); `devicectl` takes the CoreDevice id from
`xcrun devicectl list devices`. If that list says "unavailable", unplug and replug the cable.
Verified Sat 14 Nov 15:50 on the iPhone 16 Pro.

## Read the stream on the Mac

Run these from the repo root in three terminals.

```bash
brew install libimobiledevice          # once, gives iproxy
ios/mac/forward.sh                     # leave running: Mac 127.0.0.1:7700 -> phone 7700 over USB
```

```bash
source .venv/bin/activate
python -m ios.mac.record captures/bench.gdrec.gz --seconds 20 --note "bench, right hand"
python -m ios.mac.replay captures/bench.gdrec.gz --info
python -m ios.mac.replay captures/bench.gdrec.gz --snapshot captures/bench_snap   # rgb.jpg, depth.png, confidence.png
```

The phone screen changes to "Mac connected" while a reader is attached.

In Python:

```python
from ios.mac.geppetto_depth import GeppettoDepthCamera
cam = GeppettoDepthCamera("127.0.0.1", 7700, clock=clock, latency_us=60000)
cam.start()
f = cam.read()          # newest DepthFrame or None, never blocks
cam.status()            # connected, frames, fps, tracking, plane, error
```

## WiFi instead of the cable

The app listens on every interface, so the Mac can also connect over WiFi: skip
`forward.sh` and pass the phone's WiFi address as `--host` (or set `host` under
`[camera.geppetto_depth]` in config.toml). The app does not show its address yet; read it
from Settings > Wi-Fi on the phone. Measured Sat 14 Nov 15:55 on the venue network:
16 fps, arrival gaps median 46 ms, p90 130 ms, max 330 ms, against 30 fps and a steady
33 ms over USB. Use the cable for the demo.

## Without a phone

```bash
python -m ios.mac.fake_sender                          # FAKE phone on 127.0.0.1:7700
python -m ios.mac.replay captures/bench.gdrec.gz --loop # or replay a recording on 7700
python -m pytest -q ios/mac/tests
```

Both serve the same port and protocol as the phone, so any reader works unchanged.

## Check the build without signing

```bash
cd ios/GeppettoDepth
xcodebuild build -project GeppettoDepth.xcodeproj -scheme GeppettoDepth \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
```

## Problems

| What you see | Do this |
| --- | --- |
| `forward.sh`: "No iPhone on USB" | Unlock the phone, tap Trust, try another cable. `idevice_id -l` must list the phone. |
| Reader: `ConnectionRefusedError` | `forward.sh` is not running. |
| Reader connects, then closes at once, every second | The app is not in the foreground on the phone, or it is not running. |
| App: "no LiDAR depth on this device" | The phone has no LiDAR. Use an iPhone 12 Pro or later Pro model. |
| Table: "not found yet" | Point the phone at the bench and move it slowly for a few seconds. |
| Xcode: "iOS 27.0 is not installed" or "device not supported" | The phone runs a newer iOS than this Xcode knows. Update Xcode, or let Xcode download the device support files. |
