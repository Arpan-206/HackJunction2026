# STATUS-submission.md

Lane "submission", branch `submission` (from `origin/main` at `32bee5d`), directory `docs/submission/`. Written Sat 14 Nov 2026. Drafts only. No code changed. Nothing outside `docs/submission/` was edited.

## What is done

| File | What it holds | Sources |
| --- | --- | --- |
| `PROJECT.md` | Submission form text: one line, a 100 word summary, what it is, users, how it works, the Rokoko Robot Teleoperation angle, what is real today (with what failed), the Verda angle, team, links to fill in | STATUS.md, README.md, PRODUCT.md, DECISIONS.md, RECONCILE.md, arpan_info.md, docs/VERDA.md, the lane notes |
| `VIDEO.md` | Two minute shot list: 8 shots, each with time, length, screen, command and line; a dry-run checklist; a teleprompter script (about 200 words); a fact table per line | STATUS.md, README.md, `frontend/STATUS-robot-view.md`, STATUS-export.md, docs/VERDA.md |
| `DECK.md` | 16 slides, one row each: claim, fact or picture, source; the allowed numbers; stage rules | the same, plus docs/ideas/PITCH.md |
| `VERDA-DISCORD.md` | A paste-ready Discord message and the tables behind it: product, GPU, model, deploy time, latency, cost, use; a "do not claim" list | docs/VERDA.md, verda/STATUS-verda.md |

## Choices made without asking

| Choice | Why |
| --- | --- |
| This note sits in `docs/submission/`, not the worktree root | The lane may write only in `docs/submission/`. The verda lane did the same (`verda/STATUS-verda.md`) |
| `arpan_info.md` used as a source | The brief says to read it first. It holds the track wording and the robot open work |
| One fact from git, not from the listed files | The lane patches (score 15 / 60, `openai` provider, decisions coach) are applied on `main` in commit `4785ddd`. STATUS.md still calls them "not applied". The drafts say "source: git log" there |
| Gemma and Gemini named in PROJECT.md, DECK.md and VERDA-DISCORD.md | The Verda and Rokoko judges need the model and provider. Product copy and the video voice-over say "the AI Assistant" only (CLAUDE.md rule 6) |
| Every glove shot in the video plays a capture or mock mode | The gloves were returned at 14:30 (STATUS.md). The script says "recorded" and "played back" |
| The video shows no Verda deploy | No Verda spend (brief). It shows the stored outputs in `verda/out/compare/` |
| Arduino scoreboard and fingertip haptics left out | PRODUCT.md plans them. No status note says they were built |

## Written but untested

| Item | Why | How to test |
| --- | --- | --- |
| Every command in `VIDEO.md` | This lane wrote drafts only and did not start the core or the frontend (other lanes may hold port 8765) | Do the "Before you film" table in `VIDEO.md` |
| Vermilion string in mock mode (shot 3) | Unknown whether the simulated glove ever goes wrong on its own | Open a step at `/apprentice?mock=1` with marionette guidance and watch for one minute |
| Robot pane in the training room in mock mode | Covered by the robot-view walk, not seen by this lane | Room settings, "Show the robot hand" |
| `uv run geppetto-export` from the worktree (shot 7) | `lessons/` is untracked; the export reads whatever lessons exist where it runs | Run it from the main checkout, where the two glove slot lessons may also be found. Untested on real lessons (STATUS-export.md) |
| The speech fits 120 s | Timed by word count only | Read the script aloud with a stopwatch |

## Unverified claims, marked in the drafts

- The Junction form's field names and length limits.
- The pitch slot length.
- The repository link and whether it is public (`Blacbrd/HackJunction2026` from `decisions/STATUS-decisions.md`).
- Team roles as worded.
- The Verda Discord channel and post format.
- That the app's screens were ever run against the Verda endpoint.

## What a human must do next

1. Read `PROJECT.md` and cut it to the form's limits. Fill in the links.
2. Tonight: do the dry run in `VIDEO.md`, then film the 8 shots. Cut shot 7 if long.
3. Decide on the rename before filming. If the role picker still says "Apprentice", start the video on `/robot` (`VIDEO.md`, note for shot 1). The rename checklist is in CLAUDE.md.
4. Build the deck from `DECK.md`. Use only the numbers in its table.
5. Post `VERDA-DISCORD.md` after you check the channel's pinned format.
6. Merge this branch, or copy the files: they touch nothing else.

## Patch for a file outside this lane (not applied)

STATUS.md, handover section, the paragraph that starts "**Patches written by lanes for a human, not applied**". Commit `4785ddd` applied them. Suggested replacement:

```markdown
**Lane patches applied on main in `4785ddd`**: `[score]` 15 / 60 on calibrated
angles; expert takes set `Step.weights`; the `openai` provider (Gemma on Verda)
in the backend; Rokoko binary names and SDK path on macOS; coach model calls
run off the tick.
```

This text paraphrases the commit message. Check it against the diff before you apply it.
