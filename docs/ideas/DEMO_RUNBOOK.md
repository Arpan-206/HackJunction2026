# Demo runbook

Assumes two laptops are not needed: one laptop runs backend, frontend and Rokoko Studio, and drives the projector. Gloves connect to Studio over our own router (not venue Wi-Fi).

## No gloves

Use this when the gloves are missing, flat, or not worth the risk on the day.

1. Open the landing page `/`.
2. Press **No gloves** in the footer. It then reads **We have gloves now**, and a line says "Running without gloves: the hands are simulated." (The same switch is in Settings, Gloves section.)

What it does: the backend glove source goes to the simulator, Settings "Demo mode" (the drift check, which needs real gloves) is switched off, and the app never opens the gloves screen first. It is saved in the browser (localStorage `apprentice.noGloves`), so a reload keeps it, and on each page load the app puts the backend back on the simulator if it restarted on another source. No dev panel is needed. In mock mode (`?mock=1`, or the backend is down) the hands are already simulated.

What still works: every screen, with simulated hands. The AI Assistant works if the backend and Verda are up.

What to say: "The hands are simulated here. The gloves feed the same screens." Do not imply the motion is live from a wearer.

Switching back: press **We have gloves now**. The previous glove source and Demo mode come back. Then check `GET http://localhost:8000/api/health` shows the glove source you expect.

Optional, for the glove engine without hardware: `python -m core --fake` (repo root, debug view at `http://localhost:8765/debug`). The app demo does not need it.

## 1. Hardware checklist

- [ ] Rokoko Smartgloves II, left and right, both charged, each with its own powerbank as backup
- [ ] Glove hubs paired in Studio, both showing live in Studio
- [ ] Own Wi-Fi router, powered, on a short Ethernet or 5 GHz link to the laptop
- [ ] Laptop on charger, HDMI or USB-C adapter, spare cable
- [ ] Projector or screen tested at 1920x1080 (design targets 3 m readability)
- [ ] Two ESP32 haptic bands (only if they work; otherwise leave them off stage)
- [ ] Arduino Uno Q scoreboard (optional, cuttable)
- [ ] Webcam (optional; only for MediaPipe/ArUco extras)
- [ ] Phone hotspot as a Wi-Fi backup for Gemini
- [ ] USB stick with: this repo, screen recording of the full demo, the pre-generated lesson JSON
- [ ] Table, one chair, something flat for a paper keyboard if the piano test is shown
- [ ] Spare racket or any stick for the grip beat

## 2. Startup commands

Terminal 1, backend:
```
cd backend && uv run uvicorn app.main:app --port 8000
```
Environment (set in `backend/.env`, never commit keys):
```
LLM_PROVIDER=gemini        # or openai (Gemma on Verda), or fake
GEMINI_API_KEY=...
GLOVE_SOURCE=simulator     # switch to rokoko_udp in the dev panel
ROKOKO_UDP_PORT=14043
```
Terminal 2, frontend:
```
cd frontend && npm run dev
```
Open `http://localhost:5173/?dev=1` for the dev panel. In the panel:
1. Set glove source: `simulator` or `rokoko_udp`.
2. Toggle smoothing (One Euro); default is fine.
3. Switch LLM provider: `gemini` / `openai` / `fake`.
4. Before going on stage open `/?dev=0` to hide the panel. The dev flag is sticky in localStorage, so merely dropping `?dev=1` does not hide it (a fix is landing; verify the panel is gone anyway). The panel must not be visible to judges.

Rokoko Studio: enable Custom Streaming, JSON v3/v4, target `127.0.0.1`, port `14043`. Pair both gloves. Confirm `GET http://localhost:8000/api/health` shows the expected `glove_source` and `llm_provider`.

Gemma on Verda (backup coach): set `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `OPENAI_MODEL`; the fallback chain tries Gemini first, then Gemma on Verda (docs/MODELS.md).

## 3. Calibration ritual (do it twice: once backstage, once on stage)

1. Wearer puts gloves on, hubs on the back of the hand, strap snug.
2. In Studio, do the Studio calibration pose (arms down, hands flat) with both gloves.
3. In Geppetto: `/expert`, choose **Start from scratch**, pick the move, press calibrate.
4. **Flat**: hand flat on the table, fingers together, hold still for the 3 s countdown and capture.
5. **Fist**: loose fist, hold still for capture.
6. Check the 3D hand: open the hand and close it; the model must follow without jitter. If a finger lags, recalibrate.
7. Calibrate each wearer separately for good practice.

Note: once the learner has calibrated, scoring normalises each joint by their flat-to-fist range and maps it into the expert's range (`use_latest_calibration` in `backend/app/services/scoring.py`). Say "it normalises for your range of motion", not "it models hand size". The scored side follows the attempt's hand.

## 4. Click path (follow exactly)

1. `/` Role select. Say the hook. Click **I am an Expert**.
2. `/expert`: choose **Generate lesson**. Type: "Teach a table tennis forehand grip in three steps". Show validated lesson with guide hands. Save.
3. Back to `/expert`: **Start from scratch** opens straight on Record for a new skill. Answer the hands question, calibrate from the Gloves control (flat, fist). Record 3 takes. Show the takes model and replay, then name the skill and the move on Publish.
4. Click role switch, **I am an Apprentice**. Library, then course syllabus (shows video slots).
5. Open step 1, training room. Cycle guidance modes: marionette, shadow, ghost, side by side.
6. Learner attempts the step. Make one deliberate error. Show coaching and the AI hint.
7. Second attempt: feedback has faded to strings only. Show the score card.
8. Final step: **Test your skills**. Table tennis rally, left glove vs right glove, or vs bot. Piano play-along is the optional encore.

Cuts, in order, when time is short: piano test, scratch recording (use pre-recorded take), second attempt, duel (use bot).

## 5. Fallbacks

| Failure | Detect | Do this |
|---|---|---|
| One glove drops | 3D hand freezes or jitters | Re-press the hub, check battery. Do not switch hands mid-demo: scoring uses the reference take's hand side, so a left-hand attempt needs a master take for the left hand. Or press **No gloves** on the landing page `/` (or in Settings) and say "demo hand". |
| Backend silently on simulator | `/api/health` says simulator while gloves are on | Restart backend with `GLOVE_SOURCE=rokoko_udp`, check UDP port 14043 is not busy. |
| Both gloves drop | No frames in Studio | Press **No gloves** on the landing page `/` (no dev panel needed). The simulator drives realistic motion (`set_motion`). Tell the audience honestly it is simulated; show the recorded video next. |
| Venue Wi-Fi dead | Gemini call times out | The gloves run on our router, so only Gemini is affected. Switch to hotspot, or LLM provider `openai` (Gemma on Verda), or `fake`. |
| Gemini slow or 429 | Spinner over about 4 s | If over 4 s, switch provider by hand in the dev panel. The backend falls back to fake after 8 s anyway; `provider` in the response says which was used. Open the pre-generated lesson instead. |
| Gemini and Verda both down | Timeout | Provider `fake`: deterministic template lessons, still valid JSON. Say "offline mode". |
| Backend crash | Screens show error toasts | Frontend still renders using `synthFrame` preview motions. Restart the uvicorn command (takes under 10 s). |
| Frontend crash | White screen | Re-run `npm run dev`; or serve a built bundle `npm run build && npx vite preview` prepared in advance. |
| Projector will not mirror | No image | Use the laptop screen turned toward the judges; zoom the browser to 125 percent. |
| UDP port busy (409) | Backend returns 409 | Another instance holds 14043. Kill old uvicorn, restart. |
| Calibration drift mid-demo | Hand model off | Recalibrate flat only (5 s). Do not talk through it. |
| Everything fails | | Play the screen recording on the USB stick and narrate over it. |

## 6. Pre-demo 10-minute checklist

Minute by minute.

- T-10: Laptop on charger, notifications off, battery saver off, display scaling checked, browser zoom set.
- T-9: Start Studio, gloves on, both streams visible. Start router.
- T-8: Start backend. `GET /api/health` returns ok with expected providers.
- T-8: If UDP fails at startup the backend silently falls back to the simulator (`manager.py`). Check `GET /api/health` shows `rokoko_udp` AND have the wearer wiggle one finger and watch the hand move.
- T-7: Start frontend. Open `/?dev=1`. Set glove source `rokoko_udp`. Check the hand moves.
- T-6: LLM check: generate a test lesson once with Gemini (warms the connection). Note the `provider` returned.
- T-5: Calibrate the gloves for the gloved person (flat, fist).
- T-4: Run one full lesson step through the apprentice flow; check strings, score card, hint.
- T-3: Run the table tennis test for 10 s; check both players move.
- T-2: Hide the dev panel by opening `/?dev=0` (sticky flag), full-screen the browser, hide bookmarks and tabs.
- T-1: Gloves on the table, nothing in the way. Presenter and gloved person agree who says what. Mute phones.
- T-0: Role-select screen showing. Start.

Always keep a second tab on the pre-generated lesson and a third on the recorded demo video.
