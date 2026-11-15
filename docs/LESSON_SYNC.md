# Lesson sync: share lessons between the Mac and the Windows machine

Use this procedure to move recorded lessons from one machine to the other through Git.
The tool is `backend/scripts/lesson_sync.py`.
It uses only the Python standard library.
The same commands work on macOS and in Windows PowerShell.

## The three commands

Run each line from the repo root.

1. Export (on the machine that recorded). On Szymon's machine, use `--recorder szymon`.

```
cd backend; uv run python scripts/lesson_sync.py export --recorder arpan --wearers arpan,szymon; cd ..
```

2. Commit and push.

```
git add lessons/shared; git commit -m "Share lessons"; git push
```

3. Pull and import (on the other machine).

```
git pull; cd backend; uv run python scripts/lesson_sync.py import; cd ..
```

The lines are the same for macOS and Windows PowerShell.
PowerShell accepts `;` and forward slashes in these lines.
Add `--dry-run` to the export or the import to see the result without a write.
Add `--force` to the import to replace items that have the same id.

## What the export contains

The export writes the folder `lessons/shared/<recorder>/`.
A "take" is one glove recording of an expert.
A "core lesson folder" is the folder format of the glove engine (SPEC.md "Lesson files").

| Part | Source | Bundle path |
|---|---|---|
| Lesson records (not seeds) | `backend/data/lessons/` | `backend/lessons/` |
| Takes | `backend/data/recordings/` | `backend/recordings/` |
| Flat and fist calibrations (allowed wearers and the takes) | `backend/data/calibrations/` | `backend/calibrations/` |
| Wearer calibrations (allowed wearers only) | `backend/data/glove_calibrations/` | `backend/glove_calibrations/` |
| Core lesson folders of the takes and lessons | `backend/data/core_lessons/` | `core_lessons/` |
| Core lesson folders that Git does not track | root `lessons/` | `root_lessons/` |
| File list with SHA-256 | (made by the export) | `sync-manifest.json` |

The export skips the seed lessons (ids that start with `seed-`).
The app installs the seeds on every machine.
The per-step weights of `seed-table-tennis` come with the app, so they are the same on both machines.
Takes of a seed step keep their `lesson_id`, for example `seed-table-tennis`.

Each recorder has a separate folder.
Thus two machines can export at the same time without a Git conflict.
An export replaces only its own recorder folder.

## Wearers: the privacy rule

The repo can become public.
Thus the export takes only the calibrations of allowed wearers.
A "wearer" is the person who wore the gloves for a calibration.
The allowed wearers are the recorder and the names in `--wearers` (a comma list).
The tool compares the first word of each wearer name, in lower case.
For example, "Arpan" and "arpan 2" both match `arpan`.

The export applies these rules:

| Item | Exported when |
|---|---|
| Wearer calibration record (it holds a name) | Its wearer is allowed. |
| Flat and fist calibration (it holds no name) | An allowed wearer record points to it, or an exported take used it. |

The second rule keeps each take scoreable with its own calibration.
The export prints how many calibrations it left out, and why.
To export every wearer, add `--include-other-wearers`.
Do not use this flag for a public repo.

## The id rule

The export puts the recorder name and a hyphen in front of each id.
For example, take `0bbcca28f9f1` becomes `arpan-0bbcca28f9f1`.
The export changes every reference to that id in the same way:

- the `reference_recording_id` and `take_ids` of a lesson step,
- the `lesson_id` of a take,
- the `range_calibration_ids` of a wearer calibration,
- the folder name and the `id` in a core `lesson.json`,
- the `recording_id` in `task_config.geppetto` of a core `lesson.json`,
- the folders and calibration ids in the core lessons manifest.

An id that already starts with the prefix keeps its name.
Thus a second export gives the same files.
If nothing changed, the second export does not write.
The recorder name contains only lower-case letters and digits, at most 20.
Without `--recorder`, the tool uses the name of the computer user.
Wearer names stay as they are, because the glove engine finds a calibration by wearer name.

## Import, the force flag and the three lists

The import first checks the size and the SHA-256 of every file in the manifest.
If one file is wrong, the import stops and writes nothing.
The message names each bad file.

The import then copies each item into `backend/data/`.
It prints three lists:

| List | Meaning |
|---|---|
| added | The item was not on this machine. The import copied it. |
| skipped | An item with the same id is already on this machine. The import did not change it. The line says "identical" or "exists and differs". |
| replaced | An item with the same id was on this machine and was different. You gave `--force`, so the import replaced it. |

The import exits with code 1 only on a real error, for example a bad hash.
A skipped item is not an error.
Use `--only NAME` to import only the bundle of one recorder.

## Line endings and .gitattributes

Git for Windows usually sets `core.autocrlf=true`.
With this setting, Git can change line endings in text files.
A changed byte breaks the SHA-256 check.
Thus `.gitattributes` protects every file under `lessons/shared/`:

| Pattern | Attribute | Reason |
|---|---|---|
| `lessons/shared/**` | `-text` | Git never changes the bytes of any file in the bundle. |
| `*.npz` (traces), `*.jpg`, `*.png`, `*.gz`, `*.bin`, `*.rgmp` | `binary` | These files are not text. Git shows no text diff for them. |
| `*.json` | `-text diff` | Git keeps the bytes, but still shows a text diff. |

The bundle holds these file types now: 47 `.json`, 17 `.npz`, 41 `.jpg`.
`git check-attr -a` on real exported files gives `binary: set` and `text: unset` for `.npz` and `.jpg`.
It gives `text: unset` and `diff: set` for `.json`.

## The proof

The script `backend/scripts/lesson_sync_proof.py` repeats the proof:

```
cd backend; uv run python scripts/lesson_sync_proof.py --source-data data; cd ..
```

Give `--source-data` the original data folder.
The script only reads that folder.
It does these steps:

1. It clones the branch with `core.autocrlf=true` and checks every hash.
2. It imports the bundle into an empty data folder.
3. It scores each take with the backend scorer (`ScoringService`) two times. One time uses the original data and ids. One time uses the imported data and prefixed ids. Both use the same weights, tolerance, margin and calibrations.
4. It compares each trace and frame file of the core take folders byte for byte.

Results of the run on Sun 15 Nov, 02:18, with the 13 takes in the main checkout.
The export used `--recorder arpan --wearers arpan,szymon`.

| Check | Result |
|---|---|
| Files in the bundle | 104 (2,724,352 bytes) |
| Items | 13 takes, 9 calibrations, 6 wearer calibrations, 4 root core lessons, 0 lesson records |
| Left out | 3 wearer records of other wearers, 6 calibrations of other wearers, 35 calibrations with no wearer and no take |
| Hash check in the `core.autocrlf=true` clone | 104 of 104 correct, 0 JSON files with CRLF |
| Import into the empty data folder | added 32, skipped 0, replaced 0 |
| Score cases | 19 (6 take against take, 13 take against seed motion) |
| Worst score difference, overall and every finger | 0.000000 (limit 0.01) |
| Core take files (traces, frames) byte-identical | 44 of 44 |

Take against take, step `seed-tt-grip` of `seed-table-tennis`, with its weights and calibrations:

| Reference take | Attempt take | Original score | Imported score | Difference |
|---|---|---|---|---|
| 1526ba3d6a75 | 38d8e15a43cf | 91.9 | 91.9 | 0.0 |
| 1526ba3d6a75 | 95695d4761a4 | 87.2 | 87.2 | 0.0 |
| 1526ba3d6a75 | c298f22f6609 | 96.6 | 96.6 | 0.0 |
| 1526ba3d6a75 | d34067cfe2a3 | 97.8 | 97.8 | 0.0 |
| 1526ba3d6a75 | e6c132f23315 | 97.9 | 97.9 | 0.0 |
| 26280475dc5e (`seed-tt-snap`) | 3ef41b853f96 | 94.8 | 94.8 | 0.0 |

## Limits

- Nobody ran the tool on a real Windows machine. The Windows checks are name rules, a path length limit and a `core.autocrlf=true` clone on macOS.
- No lesson record on this machine has a real reference take. All seven lessons are seeds with a synthetic motion reference. Thus the proof uses one take as the reference for another take of the same step.
- The backend rebuilds core lesson folders by itself (`services/core_export.py`). It uses the calibration of the local machine. After this rebuild, an imported core folder can differ from the bundle. The backend scores (`POST /score`) do not change.
- A calibration with no wearer name goes into the bundle only when an exported take used it. The tool cannot tell who wore it.
- The tool keeps relative paths below 150 characters. Keep the repo folder shallow on Windows, below about 100 characters.
