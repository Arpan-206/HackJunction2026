# Hand model

`right.glb` is built from the right hand of the Godot XR Tools hand models (`hand_r.gltf`), a skinned human hand made
with MakeHuman Community Edition for VR hand tracking.

- Source: https://github.com/GodotVR/godot-xr-tools/tree/master/addons/godot-xr-tools/hands/model (`hand_r.gltf`,
  master branch)
- Licence: CC0 1.0 Universal (public domain dedication), from
  https://github.com/GodotVR/godot-xr-tools/blob/master/addons/godot-xr-tools/hands/License.md:
  "To the extent possible under law, DigitalN8m4r3 aka Miodrag Sejic has waived all copyright and related or
  neighboring rights to Hand Models for the Godot XR Tools. This work is published from: Austria. Date: 7th November
  2022." The glTF file's own `asset.copyright` field reads "CC0 Public Domain".
- `addons/godot-xr-tools/hands/About.md` in the same repository notes that the hands were made with MakeHuman, whose
  licence places no claim on exported models. The repository's code (not used here) is MIT licensed.

No attribution is required; it is given here anyway, with thanks.

## Changes

Made offline (Blender 5.2, headless):

- the bones renamed to the WebXR hand joint names (`wrist`, `thumb-metacarpal` ... `pinky-finger-tip`), so the rest
  of the app keeps the 25-joint layout it had with the earlier WebXR generic hand;
- the material and texture coordinates dropped;
- the open wrist cuff cut flat at the wrist plane, and the cup it folded into inside the palm removed.

Made at load time by `src/three/handModel.ts`: the mesh is welded, reoriented and rescaled into hand space, the wrist
opening is capped and rounded into a short tapered end, it is subdivided once, the knuckles are raised on the back of
the hand, and per-finger, wrist, crease and wood-grain vertex attributes are added. Left hands are drawn by mirroring
the right one.
