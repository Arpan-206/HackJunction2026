# STATUS-decisions: fast closed-set judgements on the Gemini Decisions API

Lane "decisions", directory `decisions/`, branch `worktree-decisions`. Written Sat 14 Nov 2026, Helsinki.
Nothing outside `decisions/` was edited. The core is imported read-only.

## 1. What works and how to run it

| Part | What it does | Tested how |
| --- | --- | --- |
| `pick_action(step_summary)` | One `choice` question over `repeat, slow_down, isolate_finger, show_keyframe, move_on`, plus a `focus` finger question in the same request. Returns action, confidence, per-action probabilities, focus finger. | 24 step summaries recorded from the real Smartgloves capture; fake transports for model, timeout, bad answer, offline; live run |
| `check_outcome(image, question)` | One `noul` (yes/no) question on a picture (bytes, path or OpenCV array, downscaled to 512 px, `resolution: low`), optional glove context as text and optional yes/no descriptions. Returns answer, P(yes), confidence. | Key-pose sketches from the capture; request body checked byte for byte; live run |
| `finger_rubric(keyframe, step)` | Five `score` questions (four levels) in one request, one per finger. Weights = expected level scaled so the largest is 1.0. | The three steps cut from the capture; live run |
| Budget | 600 ms wall clock, enforced by a thread pool `future.result(timeout)` around the whole call and by httpx socket timeouts. A late answer is logged as `event: late` and never used. | A 500 ms fake transport on a 150 ms budget returns the rule answer in under 400 ms |
| Fallbacks | `rules.py`: SPEC rule table for actions; glove curl and pinch keywords for outcomes; recorder weights, shape words and odd-finger curl for the rubric. Confidence 0 when no rule can judge. | Synthetic cases and every recorded summary |
| Offline | No key, `DECISIONS_DISABLED=1`, HTTP 401/403, or three failures in a row (10 s cool-down): no network call is made, rules answer at once. | Fake 503s, fake clock |
| Log | One JSON line per call in `logs/decisions.jsonl`: fn, ok, reason, latency_ms, budget_ms, source, why, result, tokens. Never the key, never image bytes. | Every test reads the log back |
| Adapter | `coach_adapter.DecisionsCoach` implements the core's `CoachClient`: `tip` (action to a fixed line), `name_steps` (closed set of ten shape names), `configure` (task from a fixed list, keywords when offline), `phrase_question` (rules), plus `rubric(step_json)`. | Inside `core.coach.Coach` on all 24 summaries; every line validates against `schema/coach.json` |

```bash
cd repo && source .venv/bin/activate          # the core venv (Python 3.12, uv)
python -m pytest decisions/tests -q           # 64 passed, 4 skipped (live), about 2 s, no network
DECISIONS_LIVE=1 python -m pytest decisions/tests/test_live.py -q -s     # real API, 12 calls, a few hundred tokens
python decisions/tests/make_fixtures.py       # rebuild tests/fixtures from backend/tests/fixtures/rgmp/worn_solver.rgmp.gz
```

Live run, Sat 14 Nov 11:55, from the worktree, real key, one warm-up call then measured calls:

| Call | Answer | Latency |
| --- | --- | --- |
| pick_action, step 1 stuck 8 s, overall 0.34 | show_keyframe, confidence 0.85, focus index | 709 ms (first call, cold TLS) |
| pick_action, step 1 passed | move_on, confidence 0.62 | 496 ms |
| check_outcome, key-pose sketch, "Is this a line drawing of a human hand?" | yes, P 0.77 | 298 ms |
| check_outcome, same picture, "Is there a cat in this picture?" | no | under 300 ms |
| finger_rubric, step 3 (ring curled, others straight) | index 1.0, middle 0.92, thumb 0.86, ring 0.83, little 0.70; confidence 0.48 | 186 ms |
| pick_action x5, warm connection | 5 of 5 under 600 ms | 183, 330, 316, 192, 187 ms |

What the numbers say: a warm connection answers in 180 to 330 ms, inside the
budget. The first call on a cold connection does not, so the client sends a
tiny warm-up request in the background at start (`DECISIONS_WARMUP=1`, the
default). On the rubric the model spread its weights more evenly than the rule
did (rule: ring 1.0, others 0.5 to 0.7). The rule and the model agreed on the
two actions.

## 2. Registering the adapter in the core (for a human to apply)

The core builds its coach in `core/server.py`. Two lines change:

```python
# core/server.py, with the other imports
from decisions.coach_adapter import DecisionsCoach

# core/server.py, class Core.__init__, replace
#     self.coach = Coach(None, cfg.coach, cfg.score.timing_hint_ms)
# with
        self.coach = Coach(DecisionsCoach.from_env(cfg), cfg.coach, cfg.score.timing_hint_ms)
```

That is all the coach needs. With no key the adapter answers from the rules,
so the core behaves exactly as today. `Coach.on_summary` already falls back to
`RuleCoach` when the client returns None.

Optional, the rubric into the scorer. In `core/session.py` `load_lesson`, after
the lesson is loaded:

```python
        rub = getattr(self.coach.client, "rubric", None)
        if rub is not None:
            lj = lesson.to_json()
            for s in lesson.steps:
                s.weights = rub(s.to_json(), lj)
```

Optional, counters on `/health`: `self.coach.client.describe()` returns
`enabled, calls, model_answers, timeouts, late, in_cooldown` with no secrets.

Blocking note for the core owner: `CoachClient.tip` is synchronous and the
core calls it inside the 30 Hz tick. A model call therefore stalls the tick
for its latency, 180 to 330 ms warm, at most 600 ms. Tips are rate-limited to
one per hand per 4 s (`[coach] min_interval_s`), so this is at most one short
hiccup every 4 s while a learner is failing, and none while they pass. If that
is not acceptable, set `DECISIONS_BUDGET_MS=250` or run `pick_action` in a
thread and emit the line on the next tick (not built; the core would need a
"deferred coach line" hook).

## 3. Choices made

| Choice | Why |
| --- | --- |
| REST over `httpx`, not the `google-genai` SDK | httpx is already a core dependency; the SDK is not installed and adds no control over the 600 ms budget. The request body follows the Google AI Studio "Decisions API" page (read today): `POST /v1beta/decisions`, header `x-goog-api-key`, `model`, `input` parts, `questions` with `noul`, `choice`, `score`. Verified live. |
| Key read as `GEMINI_API_KEY` only | The shared `.env` at the repo root uses that name (confirmed by the teammate session that fixed the earlier misspelling). The loader walks up from the repo root, so a worktree finds the main checkout's `.env`. `GEPPETTO_ENV_FILE` overrides. |
| Two questions per `pick_action` request | A second `choice` for the focus finger costs no extra latency (the API scores all questions in one pass) and tells `isolate_finger` which finger. |
| Four rubric levels, weights scaled to max 1.0 | Matches `Step.weights` semantics (the scorer takes a weighted mean of finger scores). All-zero levels give all 1.0, never a zero-weight hand. |
| Coach line `source` is `"gemma"` when a model chose the line | The frozen `schema/coach.json` allows only `gemma` or `rule`. Here "gemma" means "a model picked this line". The text itself always comes from a fixed table, never from a model, so no provider name reaches the learner. |
| Cool-down after three failures | Offline or behind a captive portal every call would otherwise stall the tick for the full budget. Three timeouts open a 10 s window with no network calls. |
| Fixtures from the real capture, committed | `tools.score_capture` logic: right glove records three steps, left glove is scored. 24 summaries (3 passed, 15 stuck), 3 steps, 3 key-pose sketches. Small files, regenerated by `make_fixtures.py`. The local `logs/attempts.jsonl` is not in git so it was not used. |
| Tests run from the repo root with the core venv | The lane has no venv of its own; `uv` only, nothing installed. |
| No draft PR body claims beyond this note | Everything under "written but untested" below is marked. |

## 4. Written but untested

| Part | Why untested | What would test it |
| --- | --- | --- |
| The adapter inside a running core (`python -m core --fake`) | Registration is a core edit, which this lane may not make | Apply section 2, run `--fake`, watch `coach` messages in `/debug` and `logs/decisions.jsonl` |
| `name_steps` with the model on real digests | The core never calls `name_steps` yet; tested with a fake transport only | Call it from `Recorder.stop` or a command, with the model |
| `check_outcome` on a real camera frame | No camera frame in the repo; tested on the core's key-pose sketches (the model said "hand: yes, cat: no") | A webcam JPEG with a cup in hand, question "Is the hand closed around the cup?" |
| The effect of a 180 to 600 ms stall on the 30 Hz tick | Needs the adapter registered | `/health` `tick_hz` and frame gaps during a failing attempt |
| Rate limits | Free tier is reported as 200 requests per minute; practice makes at most 15 per minute per hand | Watch for `http_429` in the log |

## 5. What a human must do next

1. Apply the two registration lines in `core/server.py` (section 2), run the core tests, run `--fake`, and check `logs/decisions.jsonl` fills.
2. Decide the tick trade-off in section 2: keep 600 ms, or lower `DECISIONS_BUDGET_MS`.
3. If the rubric should drive the scorer, apply the optional `load_lesson` lines and compare scores on `tools/score_capture.py` with and without it.
4. For the demo: start the core with the key in the environment or the `.env` in place, so the warm-up runs before the first learner attempt.
5. Review and merge draft PR #2 (https://github.com/Blacbrd/HackJunction2026/pull/2) from branch `worktree-decisions`; merge into `main` only from the main checkout.
