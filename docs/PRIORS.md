# Expert priors: what the coach knows beyond our own recordings

Lane `expert-priors`, branch `expert-priors`, Sat 14 Nov 2026. Code: `core/priors/`. Tests: `tests/test_priors_*.py`.

A prior is knowledge that comes from outside our own small glove dataset. This lane adds two priors. Each one gives the coach extra facts. Neither changes the score. The scorer stays rule-based maths (`core/scorer.py`, 15 / 60 degrees).

## Rules this lane follows

| Rule | How it is kept |
| --- | --- |
| Knowledge comes from open data, our own generator or our self-hosted Gemma | Every training example has a source tag. `tests/test_priors_provenance.py` fails on any other source. |
| No Gemini output and no Decisions API output in training | The provenance check rejects any source that names them. This lane calls no language model. |
| The real captures in `logs/live/` are the test set only | No source tag may name `logs/live`, `.rgmp` or the capture file. The captures are read only in `core/priors/real_check.py`. |
| Nothing is trained from scratch on our glove data | The letter model trains on generated poses. The piano ranges come from FurElise. |
| The scorer's maths does not change | The priors add a `priors` key to the step summary. Nothing else changes. |

Words used below:

| Word | Meaning |
| --- | --- |
| Calibrated angle | A joint angle after the wearer's own calibration. 0 is the wearer's flat hand. 90 is the wearer's fist (thumb 60). |
| MCP, PIP, DIP | The knuckle, the middle joint and the end joint of a finger. The thumb has MCP and IP (end joint). |
| Band | The range from the 5th to the 95th percentile of expert frames for one joint. |
| Top-1, top-2 | The share of tests where the right class is the first guess, or one of the first two guesses. |
| Held out | Data kept apart from training and used only to test. |

## 1. Piano posture checker

### Source and licence

| Item | Value |
| --- | --- |
| Dataset used | FurElise (Wang, Xu, Shi, Schumann, Liu, SIGGRAPH Asia 2024), https://huggingface.co/datasets/rcwang/for_elise |
| Licence | CC BY-NC 4.0: non-commercial use, credit the authors. Derived data may be shared with credit. |
| Content | 10 hours, 153 pieces, 15 elite pianists, marker motion capture, 21 hand joints per frame at 59.94 fps, the 88 key states per frame from the piano |
| Dataset first named in the brief | PianoMotion10M (Apache 2.0 code, CC BY-NC-ND 4.0 data on Zenodo record 13297386) |
| Why PianoMotion10M was not used | Its hand annotations are MANO pose parameters, added to the MANO mean pose (the loader uses `smplx` with `flat_hand_mean` left at False). The mean pose is inside the MANO model files. MANO needs a registration and has its own non-commercial research licence. We have no MANO files, so we cannot turn the annotations into joint angles. The ND clause also forbids sharing adapted material. Its poses are estimated from video, FurElise's are motion capture. |
| What was pulled | Only the left-hand joint array and the key states of 55 pieces, by HTTP range reads from the 47 GB zip. 335 MB went over the network. Nothing raw was written to disk. Only the 18 angles were kept in memory. |
| Why only the left hand | In each file the right-hand joints sit after about 60 MB of left-hand mesh vertices. Our 18 angles do not depend on the side, so the left hand stands for both. |
| Why on the Mac and not on Verda | Verda refused to start a VM: "Compute cannot be deployed using JUNCTION-2026 coupon balance until at least one payment method is added." See section 5. |

### Conversion

| Step | What happens | Code |
| --- | --- | --- |
| Joint map | FurElise wrist, thumb CMC/MCP/IP/tip and four joints per finger go into the core's 26 OpenXR joints. The missing finger metacarpal joints sit at the wrist, so the knuckle angle uses the wrist-to-knuckle bone. | `piano.furelise_to_openxr` |
| Angles | The core's own `core.hand.angle_features` gives the 18 angles. A test checks that a synthetic hand gives the same PIP, DIP and thumb angles after the round trip. | `piano.angles_of` |
| Scale | Each flexion angle is divided by the normal active range of motion (MCP 90, PIP 100, DIP 70; thumb MCP 50, IP 80) and multiplied by 90 (thumb 60). So an anatomical fist reads like a calibrated fist. Spreads stay as they are. This scale is an assumption. It is not measured on our gloves. | `piano.to_calibrated` |
| Pressing | FurElise says which key is down, not which hand pressed it. Per piece, a straight line fits the lowest held key to the hand's position along the keyboard. The hand presses when a key within 7 keys of that line is down. One piece stores keys at twice the motion rate; keys are resampled. | `piano.press_mask` |
| Rate | 59.94 fps is cut to about 10 fps. | `piano.DOWNSAMPLE` |

### Split and numbers

The two test pianists (subjects 3 and 9) were chosen before any result. Their frames never set a range.

| Measure | Value |
| --- | --- |
| Pieces, train / test | 47 / 8 (up to 4 per pianist, all 15 pianists) |
| Frames used, train | 158,365 (about 4.4 hours at 10 fps) |
| Share of train frames with the hand pressing | 44.9% |
| Pressing fit correlation per piece, median (lowest) | 0.72 (0.43) |
| Test pianists' frames inside the band, per joint | 85% to 98% (a band holds 90% of train frames by definition) |
| Test pianists' frames with all 18 joints inside | 31% |
| Test pianists' frames that raise a coach fact (filter below) | 4% |

Expert band per joint, calibrated degrees (`core/priors/models/piano_ranges.json`):

| Joint | p5 | p50 | p95 | p50 pressing | p50 not pressing |
| --- | --- | --- | --- | --- | --- |
| thumb_mcp | 10.1 | 24.1 | 44.3 | 25.0 | 23.3 |
| thumb_ip | 2.9 | 12.5 | 29.4 | 13.0 | 12.2 |
| index_mcp | 10.9 | 23.9 | 43.8 | 24.3 | 23.6 |
| index_pip | 12.8 | 30.6 | 54.2 | 31.0 | 30.2 |
| index_dip | 11.9 | 18.9 | 37.1 | 18.7 | 19.0 |
| middle_mcp | 8.1 | 19.3 | 50.5 | 19.5 | 19.1 |
| middle_pip | 6.9 | 24.6 | 53.4 | 25.8 | 23.6 |
| middle_dip | 2.3 | 10.3 | 34.1 | 10.9 | 9.8 |
| ring_mcp | 4.4 | 16.5 | 43.4 | 16.8 | 16.2 |
| ring_pip | 11.6 | 27.1 | 57.9 | 28.2 | 26.2 |
| ring_dip | 7.4 | 12.5 | 28.8 | 12.5 | 12.5 |
| little_mcp | 5.8 | 21.2 | 49.5 | 21.7 | 20.7 |
| little_pip | 3.8 | 17.0 | 52.7 | 17.2 | 16.8 |
| little_dip | 3.8 | 11.7 | 30.3 | 11.1 | 12.2 |
| spread_thumb_index | 9.3 | 28.5 | 57.9 | 27.3 | 29.5 |
| spread_index_middle | 3.8 | 12.7 | 30.2 | 13.2 | 12.4 |
| spread_middle_ring | 2.6 | 9.3 | 24.7 | 9.8 | 8.8 |
| spread_ring_little | 7.4 | 24.4 | 46.0 | 24.9 | 24.0 |

Pressing and not pressing differ by 2 degrees or less at the median. A pianist keeps one hand shape. The press is in one finger at a time, not in the whole posture. The checker therefore uses the "all" band unless the caller says the hand presses.

### Suggested tolerances for the piano task

Method: score every expert frame against the expert median posture with the core's own `finger_errors`. Perfect is the median error. Wrong is 1.5 times the 90th percentile. This is the rule STATUS.md uses for the glove slot.

| Finger | Median error | p90 error | Suggested perfect_deg | Suggested wrong_deg | Current perfect / wrong |
| --- | --- | --- | --- | --- | --- |
| thumb | 7.7 | 14.1 | 7.7 | 21.2 | 15 / 60 |
| index | 7.1 | 13.0 | 7.1 | 19.4 | 15 / 60 |
| middle | 6.9 | 15.0 | 6.9 | 22.5 | 15 / 60 |
| ring | 6.6 | 13.7 | 6.6 | 20.6 | 15 / 60 |
| little | 7.5 | 15.5 | 7.5 | 23.2 | 15 / 60 |

Read these with care. They describe how still an expert's posture is, measured by motion capture. They do not include glove noise. STATUS.md measures the glove's own cross-hand noise at median 7 and p90 16 on calibrated angles. Add the two before you use these numbers: about 10 / 40 for a piano posture step. Keep 15 / 60 until a real piano take is scored. We did not change `config.toml`.

### The checker

`PianoRanges.check(angles, pressing=None, slot_weights=None)` returns the joints outside the band, worst first. Each item has `joint`, `value`, `lo`, `hi`, `by_deg` and `direction` (`flatter`, `more_curled`, `narrower`, `wider`). A joint the calibration marks unusable is skipped.

The coach filter in `core/priors/facts.py` keeps at most 3 items. It drops the four DIP joints and anything less than 10 degrees outside. The reason is in the real-capture result below.

### Test on the real capture (held out)

The Saturday capture has two typing runs and no piano. Typing is not piano, so this is a check of the range logic only. Each run uses the newest flat and fist record taken before it, as the live core would have.

| Run, hand | Frames | Calibration record | Median joints outside the band | Frames raising a coach fact | Most frequent worst joint |
| --- | --- | --- | --- | --- | --- |
| Run 1 (13:51), right | 2668 | 45e8d7396714 | 6 | 95% | ring DIP more curled |
| Run 1, left | 2668 | 50462cbe80bd | 7 | 100% | thumb IP more curled |
| Run 2 (14:18), right | 4252 | 86612febe273 | 5 | 80% | index knuckle more curled |
| Run 2, left | 4252 | aa09534aeb5e | 10 | 82% | ring DIP more curled |

What it shows:

1. On the glove, each DIP reads about the same as its PIP (ring PIP 69, DIP 69 in run 1). Pianists bend the DIP about half as much as the PIP. The solver seems to tie the end joint to the middle joint. So DIP facts are left out of the coach filter.
2. The typing hand has the index knuckle at 62 to 77 calibrated degrees. Pianists keep it at 11 to 44. This is a real difference in posture or a scale error. We cannot tell which without a piano take on the gloves.
3. The left glove was loose on Saturday (STATUS.md). Its numbers are the least reliable.

## 2. ASL letter recogniser

### Source

| Item | Value |
| --- | --- |
| Letter shapes | The shadows lane's `fs_<letter>` curl specs in `backend/app/data/moves.json`, played on the core's synthetic hand (`core.hand.synth_hand`) |
| Wearer variation | 7 real calibration records from `backend/data/calibrations` with a usable range (both phases, three distinct joints per finger, median long-finger span at least 30 degrees). The other 25 records are empty, inverted or one number per finger. |
| Generator | `core/priors/asl.py simulate`, our own code |
| Real glove data in training | None. Calibration records give only flat and span numbers per joint. |
| Kaggle fingerspelling set (170 GB) | Not used, as the brief says. |

### How one training example is made

| Step | Model | Figure used |
| --- | --- | --- |
| Pose variation | each finger curl moves by a normal amount, the finger fan too | curl sd 0.08, fan sd 3 degrees |
| Wearer | raw = flat + target / full x span, from one real calibration record | the record's own flat and span |
| Sensor noise | normal noise on raw angles, per finger | thumb 4, index 6, middle 7, ring 14, little 8, spread 4 degrees, from the STATUS.md time-aligned medians |
| Calibration error | the core's `HandCalibration.apply` with a re-measured flat and fist | flat sd 3, fist sd 6 degrees, gain cap 2, clip 0 to 1 |
| Ideal glove | one extra wearer with no calibration error | pose and sensor noise only |

### Classes

J and Z are motion letters. They are excluded from the classes. A held J reads as its hand shape, I. The motion of J and Z is the move-step scorer's job.

Some letters have the same target in the 18 angles. They are merged into one class:

| Merged class | Why |
| --- | --- |
| G/Q | Same curls; Q points down, and the wrist turn is not in the 18 angles |
| K/P | Same curls; P points down |
| H/U/V | Same curls in the specs; H turns the wrist, V spreads two fingers, and the specs carry no spread |

That leaves 20 classes from 24 static letters.

### Model and result

The model is a linear discriminant: one mean per class and one shared covariance, 18 by 18. It is a JSON file of 11 kB (`core/priors/models/asl_lda.json`). A softmax temperature of 4.36, fitted on held-out sessions, makes the confidence honest.

Test: leave one calibration session out. The model trains on the other sessions' wearers and tests on the left-out wearers. This repeats for all 5 sessions.

| Test | Top-1 | Top-2 |
| --- | --- | --- |
| Session 11:34 UTC (1 record) | 48% | 71% |
| Session 11:39 UTC (2 records) | 71% | 91% |
| Session 11:46 UTC (2 records) | 72% | 92% |
| Session 12:04 UTC (2 records) | 72% | 91% |
| Session 12:05 UTC (1 record) | 74% | 93% |
| Mean of the 5 sessions | 67.4% | 87.7% |
| Ideal glove, model trained on all wearers | 77.1% | not measured |

Confidence against accuracy on the held-out sessions:

| Top-1 confidence | Share of tests | Mean confidence | Top-1 right |
| --- | --- | --- | --- |
| below 0.5 | 50% | 0.39 | 54% |
| 0.5 to 0.7 | 18% | 0.56 | 59% |
| 0.7 to 0.9 | 10% | 0.82 | 86% |
| 0.9 and above | 22% | 0.98 | 96% |

Confusion matrix, summed over the 5 held-out sessions (rows: true class, columns: what it read as):

| true \ read | A | B | C | D | E | F | G/Q | H/U/V | I | K/P | L | M | N | O | R | S | T | W | X | Y | recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 673 | . | 5 | . | 3 | . | . | . | . | . | . | . | 1 | 37 | . | 29 | 2 | . | . | . | 90% |
| B | . | 750 | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 100% |
| C | . | 2 | 625 | . | 2 | 1 | . | . | . | . | . | . | . | 120 | . | . | . | . | . | . | 83% |
| D | . | 5 | 2 | 703 | . | . | 38 | . | . | . | . | . | . | 1 | . | . | . | . | 1 | . | 94% |
| E | . | . | 26 | . | 391 | . | . | . | . | . | . | 58 | 57 | 183 | . | 6 | 22 | . | 7 | . | 52% |
| F | . | . | . | . | . | 750 | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 100% |
| G/Q | . | . | . | 283 | . | . | 1212 | . | . | . | 5 | . | . | . | . | . | . | . | . | . | 81% |
| H/U/V | . | . | . | . | . | . | . | 1611 | . | 484 | . | . | . | . | 155 | . | . | . | . | . | 72% |
| I | . | . | . | . | . | . | . | . | 734 | . | . | . | . | . | . | . | . | . | . | 16 | 98% |
| K/P | . | . | . | . | . | . | . | 688 | . | 720 | . | . | . | . | 92 | . | . | . | . | . | 48% |
| L | . | . | . | 140 | . | . | 606 | . | . | . | 4 | . | . | . | . | . | . | . | . | . | 1% |
| M | . | . | 1 | . | 163 | . | . | . | . | . | . | 276 | 100 | 74 | . | 29 | 99 | . | 8 | . | 37% |
| N | . | . | 2 | . | 155 | . | . | . | . | . | . | 87 | 253 | 66 | . | 44 | 135 | . | 8 | . | 34% |
| O | . | . | 276 | . | 69 | . | . | . | . | . | . | 3 | . | 396 | . | . | 1 | . | 5 | . | 53% |
| R | . | . | . | . | . | . | . | 369 | . | 130 | . | . | . | . | 251 | . | . | . | . | . | 33% |
| S | 41 | . | . | . | 99 | . | . | . | . | . | . | 12 | 12 | 35 | . | 440 | 111 | . | . | . | 59% |
| T | 2 | . | . | . | 142 | . | . | . | . | . | . | 36 | 53 | 45 | . | 197 | 265 | . | 10 | . | 35% |
| W | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 750 | . | . | 100% |
| X | . | . | 3 | 5 | 36 | . | 1 | . | . | . | . | 5 | 9 | 102 | . | . | 10 | . | 579 | . | 77% |
| Y | . | . | . | . | . | . | . | . | 5 | . | . | . | . | . | . | . | . | . | . | 745 | 99% |

The confusions match the groups the shadows lane already found the gloves cannot separate (STATUS-shadows.md): C/O, G/L/Q, H/R/U/V, K/P and M/N/S/T. L reads as G/Q 81% of the time: the two differ only in the thumb (curl 0 against 0.1), and the thumb is the least reliable joint on the real gloves.

### Test on real glove data (held out)

No letter was fingerspelled in the Saturday capture. The real held-pose lessons (`lessons/replay-*`) are other shapes. This is a sanity check, not an accuracy figure.

| Lesson (real hold) | Reads as | Confidence | Second | Confidence |
| --- | --- | --- | --- | --- |
| right flat hand, thumb open | B | 1.00 | C | 0.00 |
| left flat hand, thumb open | B | 1.00 | C | 0.00 |
| left flat hand, thumb half | B | 1.00 | C | 0.00 |
| right middle, ring, little out, thumb open | B | 0.81 | C | 0.14 |
| left index, ring, little out, thumb open | B | 0.91 | C | 0.09 |
| right half curl, thumb open | C | 0.87 | B | 0.06 |
| right index out, ring in | C | 0.77 | O | 0.17 |
| right little out, rest half, thumb half | C | 0.64 | B | 0.32 |
| left half curl, thumb half | C | 0.42 | B | 0.31 |
| left half curl, thumb closed | B | 0.72 | C | 0.25 |

Flat hands read as B and half curls read as C, which is what the shapes are closest to. The left half curl with the thumb closed reads as B: the left glove range was 0.7 to 8 degrees on Saturday (STATUS.md), so its curl is lost. Confidences are after the temperature.

## 3. How the coach gets the facts

| Item | Value |
| --- | --- |
| Flags | Environment variables `PRIORS_ASL` and `PRIORS_PIANO`, values `1`, `true`, `yes` or `on`. Off by default. There is no `config.toml` key, because the root config belongs to the core owner. |
| Where | `core/session.py` calls `core.priors.facts.from_scorer(summary, scorer)` in `_attempt_failed` and `_stuck`, before the summary goes to the attempt log and the coach. |
| When a fact appears | ASL: the lesson or step names fingerspelling or "Letter X". Piano: the task or lesson names piano. |
| Coach line | `RuleCoach.tip` puts the first fact in front of its line, for example "Reads as S, target A. Curl your index finger more." The line stays under 120 characters. |
| Failure | Any error inside a prior returns the summary unchanged. A prior never stops a session. |

The summary key, sent to the coach-tune lane (message "FIELDS"):

```json
"priors": {
  "facts": ["reads as S, target A"],
  "asl": {"read_as": "s", "read_conf": 0.62, "second": "a", "second_conf": 0.21,
          "target": "a", "matches_target": false},
  "piano": {"pressing": null,
            "outside": [{"joint": "index_mcp", "value": 3.1, "lo": 15.2, "hi": 48.9,
                         "by_deg": 12.1, "direction": "flatter"}]}
}
```

## 4. Provenance

| Manifest | Examples | Sources |
| --- | --- | --- |
| `core/priors/data/asl_letters.provenance.json` | 7,128 | `generator:core.priors.asl.simulate:fs_<letter>:calibration:<record id or ideal>` |
| `core/priors/data/piano_furelise.provenance.json` | 158,365 | `open_dataset:furelise:piece_<id>:left`, train pieces only |

`tests/test_priors_provenance.py` fails when a source is not an open dataset in the list, our generator under `core.priors`, or our Gemma on Verda. It also fails on any source that names Gemini, the Decisions API or the real captures. This lane did not call Gemma, because no step needed generated text.

## 5. Verda

| When (Helsinki) | Action | Result | Cost |
| --- | --- | --- | --- |
| 14 Nov 18:54 | Balance check | 200 EUR, nothing running | 0 |
| 14 Nov 18:56 | Start a CPU VM (CPU.4V.16G, 0.048 USD/h) | Refused by a permission prompt in this session | 0 |
| 14 Nov 19:05 | Start again after the rules changed | CPU type no longer free | 0 |
| 14 Nov 19:05 | Start a V100 VM (1V100.4V, 0.244 USD/h) | Refused by Verda: coupon balance cannot deploy compute until a payment method is added | 0 |

Nothing was created on Verda. This lane spent 0 USD. The pull ran on the Mac as small range reads instead (section 1).

## 6. What has not been verified on real gloves

| Claim | Status |
| --- | --- |
| The anatomical-to-calibrated scale for piano | Assumed from normal range of motion. Not measured. |
| A real piano take inside the expert band | Not tested. The capture has typing only. |
| The suggested piano tolerances | Expert stillness only. Glove noise is not in them. |
| Letter accuracy on real fingerspelling | Not tested. No letter was held in the capture. Accuracy is on generated wearers. |
| The H/U/V and G/Q and K/P merges | True in the 18 angles by construction. A wrist or spread feature would split them. |

## 7. How to run

```bash
source /Users/arpanpandey/Code/Junction/repo/.venv/bin/activate
python -m core.priors.train_asl                 # letter model, about 12 s
python -m core.priors.build_piano --per-subject 4   # piano ranges, about 5 min, 335 MB streamed
python -m core.priors.real_check                # held-out capture and lessons, read only
python -m pytest -q tests/test_priors_*.py
PRIORS_ASL=1 PRIORS_PIANO=1 python -m core --fake   # facts in the coach
```

## 8. Credits

| Source | Credit | Licence |
| --- | --- | --- |
| FurElise | Ruocheng Wang, Pei Xu, Haochen Shi, Elizabeth Schumann, C. Karen Liu. "FurElise: Capturing and Physically Synthesizing Hand Motions of Piano Performance." SIGGRAPH Asia 2024. | CC BY-NC 4.0 |
| PianoMotion10M (checked, not used) | Qijun Gan, Song Wang, Shengtao Wu, Jianke Zhu. ICLR 2025. | Code Apache 2.0, data CC BY-NC-ND 4.0, needs MANO |
| MANO (not used) | Romero, Tzionas, Black. SIGGRAPH Asia 2017. | MANO licence, non-commercial research, registration |
| Normal range of motion figures | Commonly cited clinical norms (AAOS and AMA guides). DIP norms vary from 70 to 90 degrees; we use 70. | Facts, no licence |
