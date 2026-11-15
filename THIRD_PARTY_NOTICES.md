# Third-party notices

The MIT licence in `LICENSE` covers the code and documents that the Geppetto team wrote.
The items below are not the team's own work. They keep their own licences.
The MIT licence does not apply to them.

Each row was read from the files in this repository on 15 Nov 2026.
"Unverified" in the Notes column means that the files do not prove the statement.

## Assets, data and vendored code in this repository

| Item | Path | Origin | Licence | Notes |
| --- | --- | --- | --- | --- |
| Hand mesh | `frontend/public/models/hands/right.glb` | Godot XR Tools hand models (`hand_r.gltf`), by DigitalN8m4r3 (Miodrag Sejic), made with MakeHuman. https://github.com/GodotVR/godot-xr-tools | CC0 1.0 | Changed by the team: bones renamed, material dropped, wrist cut. Details in `frontend/public/models/hands/LICENSE.md`. The shipped file has no copyright field, so the origin is as that file states. |
| Unitree Dex3-1 hand descriptions (web copy) | `frontend/public/models/robots/dex3_1/dex3_1_l.urdf`, `dex3_1_r.urdf` | `unitreerobotics/unitree_ros`, `robots/dex3_1_description`. https://github.com/unitreerobotics/unitree_ros | BSD 3-Clause, Copyright (c) Unitree Robotics | Copied unchanged. Full licence text: `frontend/public/models/robots/dex3_1/LICENSE.md`. No meshes are in this repository. |
| Unitree Dex3-1 hand descriptions (core copy) | `models/robots/dex3_1/dex3_1_l.urdf`, `dex3_1_r.urdf` | Same as the row above | BSD 3-Clause, Copyright (c) Unitree Robotics | Same files as the web copy. This folder has no licence file. The licence text in `frontend/public/models/robots/dex3_1/LICENSE.md` applies. |
| Picture frame model | `frontend/public/models/fancy_picture_frame_01/` | Poly Haven, by Rob Tuytel and Rico Cilliers. https://polyhaven.com/a/fancy_picture_frame_01 | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Marble bust model | `frontend/public/models/marble_bust_01/` | Poly Haven, by Rico Cilliers. https://polyhaven.com/a/marble_bust_01 | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Oil lamp model | `frontend/public/models/vintage_oil_lamp/` | Poly Haven, by Monsta3D. https://polyhaven.com/a/vintage_oil_lamp | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Wooden table model | `frontend/public/models/wooden_table_02/` | Poly Haven, by Serhii Khromov. https://polyhaven.com/a/wooden_table_02 | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Worn plaster texture | `frontend/public/textures/worn_plaster_wall/` | Poly Haven, by Dimitrios Savva. https://polyhaven.com/a/worn_plaster_wall | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Blue plaster texture | `frontend/public/textures/blue_plaster_weathered/` | Poly Haven, by Amal Kumar. https://polyhaven.com/a/blue_plaster_weathered | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Marble texture | `frontend/public/textures/marble_01/` | Poly Haven, by Rob Tuytel. https://polyhaven.com/a/marble_01 | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Walnut veneer texture | `frontend/public/textures/black_walnut_veneer_02/` | Poly Haven, by Jenelle van Heerden. https://polyhaven.com/a/black_walnut_veneer_02 | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Studio light map (HDRI) | `frontend/public/textures/hdri/artist_workshop_1k.hdr` | Poly Haven, by Oliksiy Yakovlyev. https://polyhaven.com/a/artist_workshop | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Gold leaf texture | `frontend/public/textures/metal048b/` | ambientCG, Metal048B. https://ambientcg.com/a/Metal048B | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Paper texture, white | `frontend/public/textures/paper001/` | ambientCG, Paper001. https://ambientcg.com/a/Paper001 | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Paper texture, tan | `frontend/public/textures/paper005/` | ambientCG, Paper005. https://ambientcg.com/a/Paper005 | CC0 1.0 | Per `SOURCE.md` in the folder. |
| Wood texture | `frontend/public/textures/wood/` | ambientCG, Wood049, files renamed | CC0 1.0 | Per `SOURCE.md` in the folder. |
| three.js library, minified copy | `genui/renderer/three.min.js` | Three.js Authors, Copyright 2010-2023. https://threejs.org | MIT | Vendored file. The licence header is in the file. |
| Piano joint ranges | `core/priors/models/piano_ranges.json`, `core/priors/data/piano_furelise.provenance.json` | Numbers computed from the FurElise dataset: Ruocheng Wang, Pei Xu, Haochen Shi, Elizabeth Schumann, C. Karen Liu, "FurElise: Capturing and Physically Synthesizing Hand Motions of Piano Performance", SIGGRAPH Asia 2024 | CC BY-NC 4.0 (non-commercial) | The files hold statistics only, no raw motion data. The files name the dataset and its licence. Do not use these two files for commercial purposes. The code that reads them (`core/priors/piano.py`, `build_piano.py`, `furelise_pull.py`) is the team's own. |

## Referenced, not included in this repository

| Item | Path | Origin | Licence | Notes |
| --- | --- | --- | --- | --- |
| Fonts: Alegreya Sans, Cinzel, EB Garamond | `frontend/package.json` (`@fontsource/*`), `genui/renderer/index.html` (Google Fonts link) | Fontsource packages and Google Fonts | SIL Open Font License 1.1 | No font files are in this repository. The licence is from `frontend/package-lock.json`. |
| npm packages | `frontend/package-lock.json`, `genui/package-lock.json` | npm registry | MIT, ISC, BSD, Apache-2.0, BlueOak-1.0.0, Python-2.0, plus the two rows below | Installed at build time. Not included here. |
| caniuse-lite | `frontend/package-lock.json` | npm registry | CC-BY-4.0 | Development dependency only. |
| webgl-constants | `frontend/package-lock.json` | npm registry, pulled in by `detect-gpu` | Unverified | The lock file has no licence field for this package. |
| MediaPipe | `requirements.txt`, `pyproject.toml`, `backend/pyproject.toml` (optional), `frontend/package-lock.json` (`@mediapipe/tasks-vision`) | Google | Apache-2.0 | The npm licence is from the lock file. The Python package licence is unverified. The hand model file (`models/*.task`) is git-ignored and is not included. |
| Gemma models | `verda/`, `coach_tune/`, `scripts/` (model ids such as `google/gemma-4-E2B-it`) | Google | Gemma Terms of Use | No model weights and no tuned adapters are in this repository. The licence name is unverified from the files. |
| Gemini API | `backend/`, `verda/` (`google-genai`) | Google | Google API terms | A hosted service. No Google code is included. Unverified from the files. |
| MuJoCo, PyTorch, LeRobot | `robot_policy/pyproject.toml`, `export/pyproject.toml` | Google DeepMind, PyTorch Foundation, Hugging Face | Unverified | Installed with uv. Not included here. |
| Other Python packages | `backend/pyproject.toml`, `pyproject.toml`, `requirements.txt`, `verda/pyproject.toml`, `robot_policy/pyproject.toml`, `export/pyproject.toml` | PyPI | Unverified | Installed with uv. Not included here. The OpenCV and imageio-ffmpeg wheels contain FFmpeg, which has its own licence. |

## Methods from published papers

The team wrote this code. The methods come from published work.

| Item | Path | Origin | Licence | Notes |
| --- | --- | --- | --- | --- |
| One Euro filter | `backend/app/services/smoothing/one_euro.py`, `frontend/src/mock/glove.ts` | Casiez, Roussel, Vogel, 2012 | MIT (team code) | An implementation of a published method. No third-party code was copied, per the files. |
| Dynamic time warping with a Sakoe-Chiba band | `backend/app/services/scoring.py`, `frontend/src/mock/scoring.ts` | Sakoe and Chiba, 1978 | MIT (team code) | An implementation of a published method. No third-party code was copied, per the files. |
| Rokoko stream readers | `core/rgmp.py`, `core/rcsp.py` | Written by the team against the Rokoko glove streams | MIT (team code) | No Rokoko code is included, per the files. |

## Trade marks

Rokoko, Smartgloves, Unitree, Dex3-1, Gemma, Gemini, MediaPipe, MuJoCo and Junction are trade marks of their owners.
This project uses the names only to say what it works with.
The owners do not sponsor or endorse this project.
