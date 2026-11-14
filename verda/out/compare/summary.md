# Gemma on Verda against Gemini: the same recordings, three paths

Written 2026-11-14 11:57 EET by verda/compare.py.

A `gemma-pictures` run sends the step sketches and the glove trace summary to Gemma 4 on Verda. A `gemma-text` run
sends the same summary, text only, through the backend's own LessonGenerator with the OpenAI-compatible provider.
A `gemini-text` run is the backend's existing Gemini path on that same text.

| Recording | Path | Provider | Model | Attempts | Latency s | Steps | Title | Move ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| worn-solver-left | gemini-text | gemini | gemini-3.5-flash-lite | 1 | 2.9 | 4 | Left Hand Shadow Puppet Lesson | sp_rabbit, sp_rabbit, sp_rabbit, sp_rabbit |
| worn-solver-right | gemini-text | gemini | gemini-3.5-flash-lite | 2 | 1.8 | 3 | Lesson: General Hand Poses | general_power_grip, general_spread, None |

## Steps each path wrote

### worn-solver-left: gemini-text (gemini)

- Lesson 1: Initial Pose: Keep your thumb half bent, index and middle straight, ring straight, and little half bent. [move sp_rabbit, hands left]
- Lesson 2: Curled Hand: Curl your index, middle, ring, and little fingers, while keeping your thumb half bent. [move sp_rabbit, hands left]
- Lesson 3: Relaxed Pose: Straighten your index, middle, and ring fingers, with your thumb and little finger half bent. [move sp_rabbit, hands left]
- Lesson 4: Final Pose: Straighten your index finger, half bend your middle and little fingers, and curl your ring finger. [move sp_rabbit, hands left]

### worn-solver-right: gemini-text (gemini)

- Lesson 1: Half Bent Pose: Keep your thumb, index, middle, ring, and little fingers half bent. [move general_power_grip, hands right]
- Lesson 2: Straight Pose: Straighten your thumb, index, middle, ring, and little fingers completely. [move general_spread, hands right]
- Lesson 3: Mixed Pose: Bend your thumb and little finger halfway, keep index and middle straight, and curl your ring finger. [move None, hands right]
