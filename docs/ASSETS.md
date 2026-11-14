# Assets

All assets below are CC0 (public domain). No attribution is required, but each folder carries a `SOURCE.md` with author, URL, licence and download date. Existing `textures/wood` (ambientCG Wood049) is untouched.

Paths are relative to `frontend/public` and served from `/`.

## Inventory

| Path | What | Size | Licence |
|---|---|---|---|
| `models/marble_bust_01/marble_bust_01.gltf` | Classical marble bust, backdrop piece | ~0.9 MB | CC0 Poly Haven |
| `models/vintage_oil_lamp/vintage_oil_lamp.gltf` | Brass oil lamp with glass and flame card | ~2.0 MB | CC0 Poly Haven |
| `models/wooden_table_02/wooden_table_02.gltf` | Plain wooden workbench table | ~0.5 MB | CC0 Poly Haven |
| `models/fancy_picture_frame_01/fancy_picture_frame_01.gltf` | Gilded frame with painted canvas | ~0.7 MB | CC0 Poly Haven |
| `textures/worn_plaster_wall/` | Worn plaster, wall or stage back panel (diff, normal, rough) | 1.6 MB | CC0 Poly Haven |
| `textures/blue_plaster_weathered/` | Weathered blue plaster, lapis-adjacent accent wall | 1.6 MB | CC0 Poly Haven |
| `textures/marble_01/` | Marble, plinth or tabletop | 0.5 MB | CC0 Poly Haven |
| `textures/black_walnut_veneer_02/` | Dark walnut, workbench top | 1.6 MB | CC0 Poly Haven |
| `textures/paper001/` | Cool white watercolour paper, UI cards | 2.0 MB | CC0 ambientCG |
| `textures/paper005/` | Warm tan parchment, UI cards or scrolls | 2.3 MB | CC0 ambientCG |
| `textures/metal048b/` | Worn gold leaf (diff, normal, rough, metal), mastery seal | 1.4 MB | CC0 ambientCG |
| `textures/hdri/artist_workshop_1k.hdr` | Warm interior studio HDRI | 1.7 MB | CC0 Poly Haven |

Models are glTF plus `.bin` and a `textures/` subfolder (not GLB). Keep each folder together. Textures use the file names `diff.jpg`, `normal.jpg` (OpenGL), `rough.jpg` (and `metal.jpg` for gold), all 1k JPG. Total new payload is about 16 MB.

Not included (no suitable small CC0 asset found or too heavy): easel, wax seal, scrolls, table tennis paddle, piano. Poly Haven candles (`brass_candleholders`, 9 MB) and `book_encyclopedia_set_01` (3.2 MB) were over budget.

## Art direction

Keep it a working bottega, not a museum diorama. Two or three props maximum in frame, all off the interaction axis.

- Stage backdrop: `worn_plaster_wall` on a large plane behind the hands, repeat 2x2, roughness left as is. Tint toward plaster (#d8cfc0) with `color`. Keep the carta azzurra stage as the foreground; plaster is the wall, not the stage.
- Lapis accent: `blue_plaster_weathered` only as a narrow band or lower wainscot (about a third of wall height), never full wall. Reduce `normalScale` to 0.5 so it stays flat.
- Workbench: `wooden_table_02` at y=0, hands float above it. Swap its material map for `black_walnut_veneer_02` if it looks too light. The marionette keeps Wood049 so learner and table read as different woods.
- Bust: `marble_bust_01` scaled about 0.6 (check bounds), placed rear left, partly out of focus or dimmed to 70 percent. It is a silent witness, not a feature.
- Lamp: `vintage_oil_lamp` rear right on the table. Add one warm `pointLight` (#ffb066, intensity 0.8, decay 2) at the flame; do not animate more than a faint intensity flicker (plus or minus 5 percent).
- Frame: hang `fancy_picture_frame_01` on the plaster wall, small, off-centre, at eye line above the hands. Can hold a lesson thumbnail by replacing the canvas map.
- Marble plinth: a plain `boxGeometry` with `marble_01` for the expert hand pedestal, repeat so veins are not stretched.
- Mastery seal: a flat disc or low cylinder with `metal048b` (metalness 1, roughness map), plus the Environment map; without an environment gold reads as flat yellow.
- UI cards: `paper001` (or `paper005` for the master side) as a CSS background with `background-blend-mode: multiply` over a flat plaster colour at low opacity; do not show the texture under body text at full contrast. Provide `/textures/paper005/diff.jpg` via `background-image`.
- Light: HDRI at `environmentIntensity` 0.5, `background={false}` so the stage colour stays ours. Add one soft key `directionalLight` (warm) from upper left and keep shadows soft (`ContactShadows`, blur 2.5, opacity 0.35). Lapis blue is the only saturated colour in the scene.
- Avoid: gold on everything, multiple visible flames, dense clutter, drop shadows on UI cards.

## Snippets

```tsx
import { Suspense } from 'react'
import { useGLTF, useTexture, Environment, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

// Model (gltf with external bin and textures resolves relative to the url)
function Bust(props: JSX.IntrinsicElements['group']) {
  const { scene } = useGLTF('/models/marble_bust_01/marble_bust_01.gltf')
  return <primitive object={scene} {...props} />
}
useGLTF.preload('/models/marble_bust_01/marble_bust_01.gltf')

// PBR texture set, tiled
function PlasterWall() {
  const [map, normalMap, roughnessMap] = useTexture([
    '/textures/worn_plaster_wall/diff.jpg',
    '/textures/worn_plaster_wall/normal.jpg',
    '/textures/worn_plaster_wall/rough.jpg',
  ])
  ;[map, normalMap, roughnessMap].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(2, 2)
  })
  map.colorSpace = THREE.SRGBColorSpace
  return (
    <mesh position={[0, 1.5, -2]} receiveShadow>
      <planeGeometry args={[8, 4]} />
      <meshStandardMaterial map={map} normalMap={normalMap} roughnessMap={roughnessMap} />
    </mesh>
  )
}

// Gold seal (also needs metalnessMap from metal.jpg)
// <meshStandardMaterial map={...} normalMap={...} roughnessMap={...} metalnessMap={...} metalness={1} />

// Scene lighting
function Lighting() {
  return (
    <>
      <Environment files="/textures/hdri/artist_workshop_1k.hdr" environmentIntensity={0.5} background={false} />
      <directionalLight position={[-3, 4, 2]} intensity={1.1} color="#ffe2bd" castShadow />
      <ContactShadows position={[0, 0, 0]} opacity={0.35} blur={2.5} scale={6} />
    </>
  )
}
```

Wrap model and texture components in `<Suspense>`. The HDRI is about 1.7 MB: lazy load it after first paint if startup time matters.
