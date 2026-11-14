# Accounts and data: do we need a database?

**Recommendation for the demo: no database and no sign-in.** Open two browser windows on the same backend: one on the expert side (`/master`, being renamed `/expert`), one on the learner side (`/apprentice`). The FastAPI backend already persists lessons, recordings and calibrations as JSON files in `DATA_DIR`, so a lesson the expert saves in window 1 appears in the learner's library in window 2 after a refresh. That is the whole "two platforms" story, and it costs zero demo seconds on a login screen.

## Why not sign-in for the demo

- Judges give a demo two to four minutes. A login flow spends 20 seconds on something every app has.
- One laptop runs both roles anyway (one pair of gloves, one projector).
- The role select screen already frames the two sides. Say "on the left, the expert's studio; on the right, the apprentice's bottega".

## Demo setup

1. Start the backend and frontend as usual.
2. Window A (left half of the screen): `http://localhost:5173/master` (expert).
3. Window B (right half): `http://localhost:5173/apprentice` (learner).
4. Expert saves a lesson in A, learner refreshes B and opens it.

If a teammate's laptop joins as a second learner, point its browser at the demo laptop's IP (Vite `--host`), same backend, same data.

## When a database becomes worth it (after the hackathon)

Real accounts matter once experts get paid and lessons are owned. Supabase fits well because it gives Postgres, auth and file storage in one place:

| Need | Supabase piece | Notes |
| --- | --- | --- |
| Expert and learner accounts | Auth (email magic link or Google) | `profiles` table with `role in ('expert','learner')` |
| Lessons, steps, tests | Postgres tables mirroring `docs/CONTRACT.md` | `lessons.owner_id` references `profiles.id`; Row Level Security: experts edit their own, learners read published |
| Recordings (frames) | Storage bucket, one gzip JSON per recording | Frames are large; keep only metadata in Postgres |
| Attempts and progress | `attempts` table (learner, step, score JSON, created_at) | Drives the practice plan and the expert's "where learners struggle" view |
| Videos (future video lessons) | Storage bucket | Signed URLs in `Step.video_url` |

Migration path: the backend's `services/storage/json_store.py` is the only place that reads and writes data. Swap it for a Supabase-backed store with the same interface and nothing above it changes. Keep the service key on the backend; the frontend never talks to Supabase directly unless we add auth there.

Estimated effort: about 3 to 4 hours for auth plus tables plus the store swap. Not worth it before the demo.
