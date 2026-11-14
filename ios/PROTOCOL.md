# Geppetto Depth wire protocol, version 1

The iPhone app `GeppettoDepth` serves this stream. The Mac reads it in `ios/mac/geppetto_depth.py`.

## Transport

- The app opens a TCP listener on port **7700** on the phone (Network.framework).
- The Mac forwards its local port 7700 to the phone port 7700 over the USB cable with `iproxy` (`ios/mac/forward.sh`). The Mac then connects to `127.0.0.1:7700`. No WiFi is involved.
- The stream goes one way: phone to Mac. The Mac sends nothing. The app ignores any bytes it receives.
- The app serves one client at a time. A new connection replaces the old one.
- The app sends at most 30 frames per second. If the previous frame is still in flight, the app drops the new frame. So a slow reader gets fewer, fresh frames, never a growing backlog.

## Byte order and types

All numbers are little-endian. `f16` is IEEE 754 half precision. `f32` and `f64` are IEEE 754 single and double precision. Matrices are row-major: the first four `f32` of a 4x4 matrix are its first row.

## Packet

Each packet is an 8-byte prefix and then a payload.

| Offset | Size | Type | Field |
| --- | --- | --- | --- |
| 0 | 4 | bytes | magic, ASCII `GDP1` |
| 4 | 4 | u32 | payload length in bytes (everything after these 8 bytes) |

The payload starts with a fixed header of 216 bytes. Offsets below count from the start of the payload.

| Offset | Size | Type | Field |
| --- | --- | --- | --- |
| 0 | 2 | u16 | version, 1 |
| 2 | 2 | u16 | flags (see below) |
| 4 | 4 | u32 | frame id, counts up from 1 for each sent frame |
| 8 | 8 | f64 | timestamp: `ARFrame.timestamp`, seconds, the phone's uptime clock |
| 16 | 2 | u16 | depth width (256) |
| 18 | 2 | u16 | depth height (192) |
| 20 | 2 | u16 | JPEG width (640) |
| 22 | 2 | u16 | JPEG height (480) |
| 24 | 2 | u16 | width of the image that K belongs to (the full camera image, 1920) |
| 26 | 2 | u16 | height of the image that K belongs to (1440) |
| 28 | 4 | u32 | depth bytes, width x height x 2 |
| 32 | 4 | u32 | confidence bytes, width x height, or 0 |
| 36 | 4 | u32 | JPEG bytes |
| 40 | 36 | f32 x 9 | K, the 3x3 camera intrinsics, row-major, in pixels of the full camera image |
| 76 | 64 | f32 x 16 | camera transform, 4x4, camera to world, row-major |
| 140 | 64 | f32 x 16 | table plane pose, 4x4, plane to world, row-major (identity if no plane) |
| 204 | 8 | f32 x 2 | table plane extent in metres: along the plane's x axis, then along its z axis |
| 212 | 1 | u8 | tracking state: 0 not available, 1 limited, 2 normal |
| 213 | 3 | bytes | reserved, zero |

Then three blobs follow, in this order, with the lengths given in the header:

1. Depth: `f16`, row by row, metres. 0 or NaN means no reading.
2. Confidence: `u8`, row by row: 0 low, 1 medium, 2 high (`ARConfidenceLevel`). Absent when its length is 0.
3. JPEG: the colour image, downscaled.

The payload length equals 216 plus the three blob lengths. A reader must skip any bytes past the three blobs, so later versions can append fields.

### Flags

| Bit | Meaning |
| --- | --- |
| 0 | the table plane fields are valid |
| 1 | the confidence blob is present |

## Coordinate frames

- All images keep the sensor orientation: landscape, with the phone's top to the left (`UIInterfaceOrientation.landscapeRight`). The app locks its screen to this orientation, so the preview is upright.
- Depth and colour cover the same field of view. A depth pixel maps to the colour image by scaling only.
- K is for the full camera image (`ARCamera.intrinsics`). The Mac reader scales it to the JPEG size, so `DepthFrame.K` is at the colour resolution, as `core/camera/depth.py` requires.
- The camera transform is `ARCamera.transform` as ARKit gives it. ARKit's camera axes are: x right, y up, z toward the viewer (the camera looks along -z). To get an OpenCV camera (y down, z forward), multiply on the right by `diag(1, -1, -1, 1)`. The reader offers `opencv_pose()` for this.
- The world frame is gravity aligned: y points up (`worldAlignment = .gravity`). The origin is where the session started.
- The table plane is the largest horizontal plane anchor by area. Its pose is the anchor transform, moved to the plane's centre and turned by `planeExtent.rotationOnYAxis`. The plane's y axis is the surface normal (up). Its x and z axes run along the two extents.

## Recording file (`.gdrec`, optionally `.gdrec.gz`)

`ios/mac/record.py` writes and `ios/mac/replay.py` reads this file.

| Size | Type | Field |
| --- | --- | --- |
| 8 | bytes | ASCII `GDREC1\n\0` |
| 4 | u32 | length of a UTF-8 JSON note (what made the recording, for example `"fake sender"`) |
| n | bytes | the JSON note |

Then repeated records until the end of the file:

| Size | Type | Field |
| --- | --- | --- |
| 8 | u64 | arrival time on the Mac, microseconds, core clock |
| n | bytes | one complete packet, exactly as it came over the wire (prefix and payload) |

The packet carries its own length, so the record needs no other length field.
