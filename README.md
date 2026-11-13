# Geppetto

A master demonstrates a hand skill wearing a Rokoko Smartglove. A learner
wearing the other glove copies it and is scored and coached live.

- `SPEC.md` is the contract between the core and the viewer. If code and
  `schema/` disagree, the schema wins.
- `core/` is the Python service between the sensors and the viewer:
  `python -m core --fake` runs it with no hardware on `ws://localhost:8765/ws`.
- `viewer/` is the Three.js viewer (separate owner).
- `STATUS.md` says what works, what is untested, and what to check first with
  real gloves. `DECISIONS.md` lists every choice made where SPEC.md was silent.

```bash
cd repo && source .venv/bin/activate
python -m pytest -q
python -m core --fake            # then open http://localhost:8765/debug
```
