# STATUS-expert-priors.md

Lane `expert-priors`, branch `expert-priors` (from local `main` at `6dabaf6`), worktree `.claude/worktrees/expert-priors`. Sat 14 Nov 2026, 18:54 to about 19:20 Helsinki. No gloves were used. Full write-up: `docs/PRIORS.md`.

## What works, and how to run it

| Piece | Result | Run |
| --- | --- | --- |
| Piano posture ranges | 18-joint expert bands from 47 FurElise pieces (13 pianists, 158,365 frames). The 2 held-out pianists sit inside the band 85% to 98% per joint. | `python -m core.priors.build_piano --per-subject 4` (about 5 min, streams 335 MB, saves nothing raw) |
| Piano posture checker | `PianoRanges.check` names each joint outside the band, with direction and degrees. The coach filter raises a fact on 4% of held-out pianist frames. | `core/priors/piano.py`, `core/priors/facts.py` |
| Suggested piano tolerances | Per finger, perfect 6.6 to 7.7, wrong 19.4 to 23.2 (expert stillness only, no glove noise). Current 15 / 60 is unchanged. | in `core/priors/models/piano_ranges.json` |
| ASL letter recogniser | 20 classes from 24 static letters (J and Z excluded; G/Q, K/P, H/U/V merged). Leave-one-session-out top-1 67.4%, top-2 87.7%. Confidence calibrated: at 0.98 it is right 96% of the time. Confusion matrix in docs/PRIORS.md. | `python -m core.priors.train_asl` (about 12 s) |
| Coach facts | `summary["priors"]` behind `PRIORS_ASL` and `PRIORS_PIANO` (environment, off by default). The rule coach puts the first fact in front of its line. | `PRIORS_ASL=1 PRIORS_PIANO=1 python -m core --fake` |
| Provenance | Two manifests, one source tag per example. The test fails on any source that is not an open dataset, our generator or our Gemma on Verda, and on Gemini, Decisions or `logs/live`. | `python -m pytest -q tests/test_priors_provenance.py` |
| Real-capture check | Typing runs of the Saturday capture through the piano ranges; real held-pose lessons through the letter model. Read only. | `python -m core.priors.real_check` |
| Field names to coach-tune | Sent at 19:07 by SendMessage, first line "FIELDS". | |

Tests: `python -m pytest -q` from the worktree root: 210 passed (the core suite plus 20 new priors tests).

## Choices made without asking

| Choice | Why |
| --- | --- |
| FurElise, not PianoMotion10M | PianoMotion10M stores MANO pose offsets. They need the MANO model files (registration, own licence), which we do not have. Its data is CC BY-NC-ND. FurElise gives joint positions and is CC BY-NC 4.0. The brief allowed this fallback. |
| Left hand only | The right-hand joints sit behind 60 MB of mesh per piece. The 18 angles do not depend on the side. |
| Pull on the Mac | Verda refused the VM (see cost table). Range reads kept the transfer to 335 MB, and nothing raw was saved. |
| Flags in the environment, not config.toml | The root `config.toml` belongs to the core owner. |
| DIP joints left out of piano coach facts; 10 degree minimum | On the real gloves the DIP reads like the PIP; pianists bend it half as much. DIP facts would fire on every glove frame. |
| Linear discriminant, not a neural net | 20 classes, 18 features, generated data: the small model is enough, inspectable and an 11 kB JSON. |

## Written but untested on real gloves

| Item | Why untested |
| --- | --- |
| Piano facts on a real piano take | The capture has typing only. On typing, 80% to 100% of frames raise a fact (index knuckle 62 to 77 against the pianists' 11 to 44). Typing posture or scale error: not known. |
| The anatomical-to-calibrated scale | An assumption from normal range of motion. |
| Letter reading on real fingerspelling | No letter was held in the capture. Real flat hands read as B and half curls as C, which is a sanity check only. |
| `PRIORS_*` flags in a live session | Tested in unit tests on summaries and with `RuleCoach`; not watched in `/debug` with `--fake` or `--replay`. |

## What a human must do next

1. Add a payment method on Verda, or keep VMs off: coupon credit cannot start VMs. The coach-tune lane's A100 start will hit the same rule.
2. Record one piano take and one fingerspelled alphabet with the gloves, then run `python -m core.priors.real_check` with those windows added to `TYPING_WINDOWS`. This verifies the scale and the letter accuracy.
3. Decide whether a piano step should use about 10 / 40 (expert stillness plus glove noise) instead of 15 / 60. Do not change it before step 2.
4. Optional: a wrist pitch feature and a spread target in the `fs_` moves would split G/Q, K/P and H/U/V.

## Files outside `core/priors/` changed (allowed by the brief)

| File | Change |
| --- | --- |
| `core/session.py` | One import (`from .priors.facts import from_scorer as prior_facts`) and one line `summary = prior_facts(summary, sc)` in `_attempt_failed` and in `_stuck`. With both flags off it returns the same summary object. |
| `core/coach.py` | `RuleCoach.tip`: the first `summary["priors"]["facts"]` item, when present, leads the line; with no finger hint, the fact alone is the tip. |
| `docs/VERDA.md` | New section "Expert-priors lane: no GPU used". |
| `docs/submission/VERDA-DISCORD.md` | New section "Expert-priors lane (no Verda spend)". |

SPEC.md, docs/CONTRACT.md, `core/scorer.py`, `config.toml`, the backend and the frontend are unchanged. No patch for other lanes is needed.

## Cost table

| When (Helsinki) | Event | Instance | Hours | USD | Running total USD | Balance |
| --- | --- | --- | --- | --- | --- | --- |
| 14 Nov 18:54 | Balance check | none | 0 | 0 | 0 | 200 EUR |
| 14 Nov 18:56 | VM start refused by a permission prompt | CPU.4V.16G | 0 | 0 | 0 | 200 EUR |
| 14 Nov 19:05 | VM start: type no longer free | CPU.4V.16G | 0 | 0 | 0 | 200 EUR |
| 14 Nov 19:05 | VM start refused by Verda (coupon needs a payment method) | 1V100.4V | 0 | 0 | 0 | 200 EUR |
| 14 Nov 19:20 | Teardown check: no instance at all on the account | none | 0 | 0 | 0 | 199.91 EUR (the 0.09 EUR drop is another lane's spend; this lane created nothing) |

Nothing of this lane exists on Verda. The 50 USD floor is untouched.
