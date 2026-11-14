# Gemma on Verda against Gemini: the same recordings, three paths

Written 2026-11-14 12:32 EET by verda/compare.py.

A `gemma-pictures` run sends the step sketches and the glove trace summary to Gemma 4 on Verda. A `gemma-text` run
sends the same summary, text only, through the backend's own LessonGenerator with the OpenAI-compatible provider.
A `gemini-text` run is the backend's existing Gemini path on that same text.

| Recording | Path | Provider | Model | Attempts | Latency s | Steps | Title | Move ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| worn-solver-left | gemma-pictures | verda-gemma | google/gemma-4-31B-it | 1 | 19.1 | 4 | Hand Sequence Exercise | general_spread, general_fist, general_spread, None |
| worn-solver-left | gemma-text | openai | google/gemma-4-31B-it | 1 | 10.8 | 3 | Hand Sequence Exercise | general_spread, general_fist, None |
| worn-solver-left | gemini-text | gemini | gemini-3.5-flash-lite | 1 | 2.5 | 4 | Left Hand Shadow Puppet Lesson | sp_rabbit, sp_snail, sp_rabbit, sp_swan |
| worn-solver-right | gemma-pictures | verda-gemma | google/gemma-4-31B-it | 1 | 10.2 | 3 | Hand Pose Sequence | None, general_spread, None |
| worn-solver-right | gemma-text | openai | google/gemma-4-31B-it | 1 | 8.2 | 3 | Hand Flexibility Sequence | general_spread, general_fist, None |
| worn-solver-right | gemini-text | gemini | gemini-3.5-flash-lite | 1 | 1.8 | 3 | Lesson: Hand Poses | general_power_grip, general_spread, None |

## Steps each path wrote

### worn-solver-left: gemma-pictures (verda-gemma)

- Lesson 1: Open Hand: Keep your index, middle, and ring fingers straight while slightly bending your thumb and little finger. [move general_spread, hands right]
- Lesson 2: Closed Fist: Curl all four fingers into your palm and keep your thumb half bent. [move general_fist, hands right]
- Lesson 3: Return to Open: Straighten your index, middle, and ring fingers again, leaving the thumb and little finger slightly bent. [move general_spread, hands right]
- Lesson 4: Partial Curl: Curl your ring finger fully, half-bend your middle and little fingers, and keep your index finger straight. [move None, hands right]

### worn-solver-left: gemma-text (openai)

- Lesson 1: Open Hand: Keep your index, middle, and ring fingers straight while slightly bending your thumb and little finger. [move general_spread, hands right]
- Lesson 2: Closed Fist: Curl your index, middle, ring, and little fingers tightly into your palm. [move general_fist, hands right]
- Lesson 3: Partial Grip: Keep your index finger straight and curl your ring finger, while slightly bending the others. [move None, hands right]

### worn-solver-left: gemini-text (gemini)

- Lesson 1: Open stance: Keep your thumb half bent, extend your index, middle, and ring fingers straight, and half bend your little finger. [move sp_rabbit, hands left]
- Lesson 2: Full curl: Keep your thumb half bent, and curl your index, middle, ring, and little fingers inward. [move sp_snail, hands left]
- Lesson 3: Open stance repeat: Return your thumb to half bent, extend your index, middle, and ring fingers straight, and half bend your little finger. [move sp_rabbit, hands left]
- Lesson 4: Partial curl: Keep your thumb half bent, straighten your index finger, half bend your middle and little fingers, and curl your ring finger. [move sp_swan, hands left]

### worn-solver-right: gemma-pictures (verda-gemma)

- Lesson 1: Partial Curl: Bend all your fingers and your thumb halfway. [move None, hands right]
- Lesson 2: Open Hand: Straighten all your fingers and your thumb completely. [move general_spread, hands right]
- Lesson 3: Ring Finger Curl: Curl your ring finger tightly while keeping your index and middle fingers straight. [move None, hands right]

### worn-solver-right: gemma-text (openai)

- Lesson 1: Open Hand: Straighten all your fingers and keep your palm open. [move general_spread, hands right]
- Lesson 2: Relaxed Curl: Bend all your fingers slightly into a relaxed, half-closed position. [move general_fist, hands right]
- Lesson 3: Partial Grip: Keep your index and middle fingers straight while curling your ring finger tightly and bending your thumb and little finger. [move None, hands right]

### worn-solver-right: gemini-text (gemini)

- Lesson 1: Half Bent Pose: Keep your thumb, index, middle, ring, and little fingers half bent. [move general_power_grip, hands right]
- Lesson 2: Straight Pose: Straighten all your fingers completely. [move general_spread, hands right]
- Lesson 3: Curled Ring Pose: Curl your ring finger inward while keeping your index and middle fingers straight. [move None, hands right]
