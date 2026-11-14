# decisions: fast closed-set judgements during practice

Three functions on the Gemini Decisions API (`gemini-decision-1`), each with a
600 ms budget and a rule fallback. Nothing blocks when the API is slow or offline.

| Function | Question type | Answer | Fallback |
| --- | --- | --- | --- |
| `pick_action(step_summary)` | one `choice` over `repeat, slow_down, isolate_finger, show_keyframe, move_on`, plus a `focus` finger | `ActionDecision(action, confidence, focus, probabilities, source, reason, latency_ms)` | the SPEC rule table: passed, early, one bad finger, stuck, nearly passed, getting worse |
| `check_outcome(image, question)` | one `noul` (yes/no) on the picture, optional glove context as text | `OutcomeDecision(answer, probability, confidence, ...)` | keyword rules on the glove curl and pinch; confidence 0 when it cannot judge |
| `finger_rubric(keyframe, step)` | five `score` questions, one per finger, four levels | `FingerRubric(weights, confidence, levels, ...)`, the largest weight is 1.0 | recorder weights, then a shape word in the step name, then the finger whose curl stands out |

`source` is `"model"` or `"rule"`. `reason` is `"model"`, or why the model gave
nothing and which rule fired, for example `timeout:stuck_low`.

## Run

```bash
# from the repo root with the core venv active (source .venv/bin/activate)
python -m pytest decisions/tests -q                      # 64 offline tests, no network
DECISIONS_LIVE=1 python -m pytest decisions/tests/test_live.py -q -s   # real API, a few hundred tokens
python decisions/tests/make_fixtures.py                  # rebuild the fixtures from the real capture
```

```python
from decisions import pick_action, check_outcome, finger_rubric

d = pick_action(step_summary)  # step_summary: schema/step_summary.json
o = check_outcome(
    jpeg_bytes,
    "Is the hand closed around the cup?",
    context={"curl": hand.curl, "pinch": hand.pinch},
)
r = finger_rubric(step.to_json(), step.to_json(), lesson=lesson.to_json())
```

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | from the shared `.env` (walk-up from the repo root, or `GEPPETTO_ENV_FILE`) | the key; never logged |
| `DECISIONS_BUDGET_MS` | 600 | hard wall-clock budget per call |
| `DECISIONS_DISABLED` | unset | `1` forces rules only, no network |
| `DECISIONS_LOG` | `logs/decisions.jsonl` | one JSON line per call |
| `DECISIONS_WARMUP` | 1 | open the TLS connection at start with a tiny request |

## Files

| File | What |
| --- | --- |
| `config.py` | endpoint, model, key discovery, thresholds read from `config.toml [score]` |
| `client.py` | `DecisionsClient`: request body, thread-pool budget, cool-down after three failures, answer parsers |
| `rules.py` | the three rule fallbacks |
| `judgements.py` | the three functions, prompts, image parts, logging |
| `coach_adapter.py` | `DecisionsCoach`, the core's `CoachClient` (tip, name_steps, configure, phrase_question, rubric) |
| `log.py` | `JsonlLog` |
| `tests/` | offline tests on the real capture fixtures; `test_live.py` opt-in |
| `tests/make_fixtures.py` | builds `tests/fixtures/` from `backend/tests/fixtures/rgmp/worn_solver.rgmp.gz` |

See `STATUS-decisions.md` for the registration lines, choices made and open work.
