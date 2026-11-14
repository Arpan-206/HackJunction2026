# 10. The learner pipeline: from first demo to "Test your skills"

Scope: how a learner moves through an Apprentice lesson, how mastery is decided, what makes it fun, what the coach says, and what to build in a hackathon day. This builds on `research/02_hand_training.md` (feedback science, scoring, fading) and does not repeat it. Shapes refer to `docs/CONTRACT.md`. Claims from the web carry a link. Anything marked (my judgement) is opinion. Where I could not verify something I say so.

## 1. The direct answer

**"Would it be repetitive movement followed by a test?" Partly, but that is the weakest version.**

Repetition followed by a test is the right skeleton but two things must change:

1. **Repetition must change shape as the learner improves.** Blocked, fully guided repetition makes the learner look good while the guidance is on (the guidance hypothesis in 02). So reps start guided (strings on), then lose the guidance (ghost only, then blind) based on performance, not time.
2. **The test is not one finale. It is small and frequent.** The blind attempts inside each step are low-stakes tests, and a blind review on a later day is the real retention test. The "Test your skills" duel is the capstone that proves it, not the only test.

The evidence behind this, in plain terms:

| Principle | What the evidence says | Strength for us |
|---|---|---|
| Spacing | Spaced practice beats massed practice for motor skills, mean weighted effect 0.46 across 63 studies ([Donovan and Radosevich 1999](https://www.gwern.net/docs/spaced-repetition/1999-donovan.pdf)). Spacing boosts retention more than in-session performance ([Cepeda et al. 2006](https://www.evullab.org/pdf/CepedaPashlerVulWixtedRohrer-PB-2006.pdf)). Older motor reviews disagreed about whether spacing helps acquisition itself (see the 1988 Lee and Genovese discussion in the same search), so promise retention, not faster first learning. | Good. Build spaced review. |
| Interleaving (random vs blocked) | Mixed. A 2024 retention meta-analysis found a medium benefit of high contextual interference in the lab ([PMC11237090](https://pmc.ncbi.nlm.nih.gov/articles/PMC11237090/)), a transfer meta-analysis favoured random practice ([Czyż et al. 2024](https://pubmed.ncbi.nlm.nih.gov/39205981/)), but field and sport studies show small or non-significant effects (same PMC review, citing Brady 2004 and Ammar et al. 2023). | Moderate. Use it lightly, after the first acquisition (my judgement). |
| Testing effect | Robust for verbal material. For motor skills the evidence is thinner: one group found long-term transfer benefits, a later study found within-session gains but no clear between-session advantage ([Boutin et al., HAL](https://hal.archives-ouvertes.fr/hal-01662870)). | Preliminary. Treat blind attempts as the measure of learning (consistent with 02 rule 10), not as a proven booster. |
| Optimal challenge | Learning is best when difficulty matches the learner and is raised as skill grows; practice that is too easy or too hard hurts ([Guadagnoli and Lee 2004](https://experts.mcmaster.ca/scholarly-works/1313883)). The framework is conceptual and hard to apply, so it is a design heuristic only. | Use as a rule: raise difficulty when the learner is clean, lower it when they fail twice. |
| Errorless vs errorful | A 2026 systematic review found no consistent overall advantage for errorless learning, with benefits only in subgroups such as children and impaired learners ([Frontiers 2026](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1722743/full)). | Do not make the strings stop all errors. Let reps be imperfect, and fade the strings. |
| Concurrent vs terminal feedback, guidance | Covered in 02 (Sigrist, Walsh, Frontiers 2017). Terminal feedback after every attempt, concurrent only early. | Already adopted. |

Bottom line for the pipeline: **demo, guided reps, guided-then-fading reps, blind attempts, spaced blind reviews, then a capstone duel.** The test is woven through, not bolted on.

## 2. What the apps teach us (and what to ignore)

### Duolingo (the best-documented engagement engine)

- **Spaced repetition:** Duolingo published half-life regression, a trainable model of memory strength per item, and says it lifted engagement by about 12 percent in production ([Duolingo blog](https://blog.duolingo.com/how-we-learn-how-you-learn), [Settles and Meeder, ACL 2016](https://preview.aclanthology.org/fix_video/P16-1174.pdf); the 12 percent is a company claim reported by [VentureBeat](https://venturebeat.com/ai/how-duolingo-is-using-ai-to-humanize-virtual-language-lessons)).
- **Difficulty model (Birdbrain):** a logistic-regression model inspired by item response theory, where the chance of a correct answer depends on exercise difficulty and learner ability, updated by one gradient step after each exercise. Duolingo says A/B tests show lessons built at the right difficulty help learners learn more ([Birdbrain post](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain)). I did not confirm any Elo link, so I do not claim one.
- **Streaks:** the Streak Wager test (stake in-game currency to extend a streak, double if you hold it) made learners return more and complete more lessons ([Duolingo engineering blog](https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals)). Duolingo's retention PM says the first seven days are most fragile and that letting users choose their own streak length raised retention ([Lenny's Newsletter](https://www.lennysnewsletter.com/p/duolingo-streaks)). Percentage lifts quoted in blogs conflict, so I do not rely on them.
- **Leagues and hearts:** I found no primary evidence on hearts or on leagues' effect on learning. Treat both as unproven for learning (my judgement).
- **Critique:** XP measures lessons completed, not learning quality (opinion pieces in the same searches). The lesson for us is to make our points a function of mastery, not of time spent.

Transferable ideas: short sessions, a model of per-item memory that schedules reviews, difficulty matched to the learner, and a streak with forgiveness.

### Instrument apps (Melodics, Yousician, Simply Piano, Flowkey)

- Melodics gives per-note early, late, missed or perfect feedback after each step, a BPM slider, looping, and a **Wait Mode** where the lesson pauses until the correct note is hit ([Melodics practice mode](https://support.melodics.com/en/articles/6777027-practice-mode), [Melodics vs Yousician](https://melodics.com/blog/melodics-vs-yousician)). Yousician has a similar wait-to-play toggle in practice mode ([Yousician support](https://support.yousician.com/hc/en-us/articles/201558362-Practice-vs-Play-mode-Guitar-)).
- Takeaway: they all separate a **practice mode** (slow, loop, wait, hints on) from a **play mode** (full tempo, scored). That is the same split as our guided stage vs blind stage. Our twist is that we measure how the hand moves, not only what sound comes out.
- I did not verify Simply Piano, Flowkey or Brilliant details in this pass, so I draw no claims from them.

### Mastery systems (Khan Academy)

Khan uses levels (Attempted, Familiar, Proficient, Mastered), where ordinary practice cannot demote you but quizzes and unit tests can ([Khan help centre](https://support.khanacademy.org/hc/da/articles/360007253831-What-is-self-paced-Mastery)). The exact 80 percent goal threshold comes from a secondary summary, so check before quoting it. Takeaway worth copying: **learning attempts are safe, tests count.** Practice reps never lower your rank; blind reviews and the duel can.

### Rhythm games and rehab games

- A Beat Saber thesis estimated that about 66 percent of learning on a first song was general skill and about 34 percent was song-specific ([Victoria University of Wellington thesis](https://openaccess.wgtn.ac.nz/articles/thesis/Complex_Perceptual-Motor_Learning_in_Virtual_Reality_Investigating_the_Generalization_of_Complex_Motor_Sequences/29631953)). A child crossover study found short-term motor gains versus tablet play ([JMIR Serious Games 2026](https://games.jmir.org/2026/1/e84995/PDF)). Both are small and I found no transfer-to-real-world study. Takeaway: variety of material (different songs, here different steps) helps general skill, which supports interleaving across steps. Do not claim real-world transfer.
- Physiotherapy exergames: reviews report better motivation and adherence from game features, but the evidence is mixed in quality and mostly small studies. I did not isolate motion feedback as the cause. Claim "may help adherence", not "proven".

### Gamification evidence: what helps and what is fluff

- Overall effect is small to medium: g about 0.46 across 30 studies, with different elements giving different effects ([Sailer and Homer / ETR&D 2020 meta-analysis](https://link.springer.com/10.1007/s11423-020-09807-z)).
- A programming-education meta-analysis attributed the benefit mainly to **levels**; badges, points, avatars and leaderboards showed no significant effect on learning there (same search, secondary summary, so check the primary paper).
- My reading: **progress structure (levels tied to mastery) helps; decorations (points, badges, leaderboards) are fluff unless they reflect real mastery.** Everything below follows this.

## 3. The pipeline

### 3.1 The unit of practice

- **Rep:** one attempt at a step, 3 to 8 seconds. Scored with `POST /score`, giving a `ScoreResult`.
- **Set:** 5 reps in a row of one step, about 30 to 45 seconds. A terminal summary appears after every set (and a one-line result after every rep).
- **Session:** about 10 minutes, see 3.2.
- **Clean rep:** a rep with `within_tolerance == true` and `overall >= 80`.

Why 80: with the contract score `100 * exp(-0.5 * (err / (1.5 * angle_deg))^2)`, an error exactly at the tolerance gives about 80, an error of half the tolerance gives about 95, and an error of 1.5 times the tolerance gives about 61. So "80" literally means "inside the master's allowed room for error" and needs no new tuning. Because the tolerance already comes from the master's own take-to-take variation (02, section 5), the threshold is fair per step.

### 3.2 Session structure (10 minutes by default, 5 minimum)

Short sessions are the Duolingo lesson; spacing across days matters more than session length (spacing evidence above).

| Min | Block | What happens |
|---|---|---|
| 0:00 to 0:45 | Warm-up and calibration check | Flat and fist capture if stale (existing `/calibrations`). |
| 0:45 to 2:45 | **Review** (only if something is due) | One blind attempt at each due step (max 2). This is retrieval, no strings. |
| 2:45 to 7:30 | **New or weak step** | Up to 2 steps, moved through stages (3.3). Watch demo, then sets. |
| 7:30 to 9:00 | **Mixed run** | Steps practised today in random order, then one full run of the lesson (02 rule 2: always finish with a whole). |
| 9:00 to 10:00 | Wrap-up | Session summary, coach plan, next review date, rank progress. |

If the learner has nothing new to learn, the whole session is review plus a mixed run (about 5 minutes). If they are mid-lesson, the session ends on a step they have just made progress on (a small win).

### 3.3 One step: demo, guided, fading, blind

Stage names map to the overlays already built: **strings** (marionette), **ghost**, **shadow/blind**.

```
        learner starts step
                |
                v
   [WATCH]  ghost plays at 0.5x then 1x, looped, 2 loops min
                |
                v
   [STRINGS]  marionette pulls the hand toward the master, live colour on every finger, optional vibration on worst finger
      sets of 5 reps; each rep scored
      3 clean reps in a row  ---------------------------+
      2 failed sets in a row -> add slow-motion, shorten  |
                                                           v
   [GHOST]   no strings; ghost hand visible, live colour only on fingers that were wrong last rep (bandwidth rule)
      3 clean reps in a row  ---------------------------+
      2 failed sets in a row -> back to STRINGS          |
                                                           v
   [BLIND]   no ghost, no live colour; terminal score after each rep only
      3 clean reps in a row = step MASTERED  ------------+
      2 failed sets in a row -> back to GHOST            |
                                                           v
   [SPACED REVIEW]  one blind rep, due at +1, +3, +7, +14 days
      pass (clean)  -> box up, next interval, step stays MASTERED
      fail          -> box back one, step returns to GHOST for one set
                                                           v
   [SEALED]  all steps mastered + review passed on a later day + duel passed
```

Rules, with reasons:

- **Fade by performance, not time**, as in 02 rule 8. For the hackathon use **2 clean reps in a row** to keep the demo fast; use 3 in the product.
- **Regress on failure.** Two failed sets in a row drops one stage (the challenge-point idea: reduce difficulty when the learner is overloaded). Never drop more than one stage at a time.
- **Always show terminal feedback after each set**, at every stage (02 rule 6).
- **Strings are a scaffold, not a punishment.** Entering blind should feel like the strings snapping, a visible reward for fading (see mechanics).
- **Interleave after acquisition.** Within a session, steps are blocked until they reach GHOST, then mixed. The mixed run shuffles steps and ends with a full lesson run. Because the evidence for interleaving is mixed, this stays a small part of the session (my judgement).
- **Step-boundary overlap** and full-run practice from 02 are kept.
- **Per-step difficulty knob:** tolerance. Optionally, in BLIND, tighten `angle_deg` by 15 percent after a mastered review (challenge point rising). Marked as a stretch, not for tomorrow.

### 3.4 Mastery thresholds (one table)

| Level | Condition | Notes |
|---|---|---|
| Step practised | At least 1 clean rep at STRINGS | Gives early reward. |
| Step **mastered** | 3 clean reps in a row at BLIND (2 for demo) | Only blind reps count: the real learning measure (02 rule 10). |
| Step **sealed** | Mastered, then 1 clean blind review passed on a later calendar day | Retention proof. |
| Lesson **Apprentice** | Started | Default rank. |
| Lesson **Journeyman** | Every step mastered, and the full run scored `overall >= 80` blind | |
| Lesson **Sealed by the Master** | Every step sealed and the duel (TestSpec) passed (`overall >= 80` average over `rounds`) | Master's name and the date on the seal. |

A seal that needs a later-day review is the honest claim: "you could still do it tomorrow" (my judgement, based on the spacing evidence above).

### 3.5 Spaced review across days

Keep it Leitner-simple, not Duolingo's regression. Boxes 0 to 4 with intervals of 1, 3, 7, 14 and 30 days after mastery. A pass moves up a box, a fail moves down one box and resets the step to GHOST. Each review is **one blind rep** (about 5 seconds), so a review session of 3 due steps is under a minute. Duolingo's half-life regression and Birdbrain-style per-learner difficulty are the roadmap upgrade ([HLR](https://blog.duolingo.com/how-we-learn-how-you-learn), [Birdbrain](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain)), only worth building once we have real attempt data.

## 4. Fun mechanics: build, show, avoid

Principle: **every mechanic must be a view of mastery**, so the fun and the learning point in the same direction.

### Build (fits and earns its place)

1. **Clean-rep combo plus the snapping strings.** A live combo counter of consecutive clean reps (the same counter that decides stage changes). Each clean rep makes one of the marionette strings visibly fray, and the last clean rep of a stage snaps the strings. Players get arcade-style feedback, and it is literally the mastery rule. Fits the Renaissance theme and the fading science.
2. **Guild ranks and the Master's Seal.** Apprentice, Journeyman, Sealed by the Master (3.4). The seal is the expert's approval: it shows the master's name, the lesson, the date and the learner's blind score, and it is only granted on retention. This ties the marketplace story (the master's authority) to learner motivation. Ranks are per lesson, with an overall guild standing later.
3. **The Duel (the "Test your skills" finale).** Already modelled by `TestSpec` (`opponent: 'bot' | 'two_player'`, `rounds`). Table tennis rally and piano play-along are natural scoring contests; the bot's skill can scale to the learner's rank (challenge point). Blind, scored, with a result screen. Two-player (left glove vs right glove) is a strong demo moment.

### Show, but fake or seed (cheap, impressive)

4. **Daily practice mark (streak, forgiving).** Count days practised, not a punishing chain. Give one free "rest day" per week and let the learner pick a goal (3 or 5 days a week), echoing the finding that user-chosen streak length raised retention ([Lenny's Newsletter](https://www.lennysnewsletter.com/p/duolingo-streaks)). Show seeded history in the demo. Real impact needs days of use, so do not claim effect.
5. **"Due for review" ledger.** A tab listing steps due today with a quill-and-ink aesthetic, driven by `next_due`.

### Avoid (and why)

- **Hearts or lives:** punishing, no learning evidence found, and failed reps are the raw material of motor learning.
- **Leagues and public leaderboards:** need a population we do not have, and evidence that they improve learning is weak (programming meta-analysis found no leaderboard effect). Mention as roadmap only.
- **XP for time spent or points per rep:** rewards volume, which is the fluff the critics describe. If points exist, derive them from rank progress.
- **Loss-framed streak guilt and paid streak freezes:** conflicts with a calm Renaissance feel and with learner wellbeing.
- **A badge for everything:** dilutes the Seal. Keep three ranks and one seal.
- **Promising transfer or rehab outcomes:** we have no outcome data. Say "practice with measured feedback".

## 5. What the AI coach says, and when

Rule: the coach is **short, specific, prescriptive** (02 rule 7) and **quiet when the learner is moving**. It never invents numbers; it rewrites the algorithmic `ScoreResult.hint`, so a failure of the LLM falls back to the deterministic hint (the contract already does this with `provider: "fake"`).

| When | Who | Say (max words) | Source |
|---|---|---|---|
| **Before a set** | Coach, text, once | One goal for this set (max 15 words), based on the worst finger from last time. Example: "Keep your ring finger bent more through the backswing." | `hint` from last attempt, or `step.instruction` the first time. |
| **During a rep** | **No speech.** Colour on fingers, optional vibration on the worst finger, max one cue per second (02 rule 9). | Nothing. | Live coach (frontend). |
| **After each rep** | Algorithmic one-liner only (about 10 words) | "Ring 22 degrees too straight. Timing 80 ms late." | `ScoreResult.hint`, `worst_finger`, `timing`. |
| **After each set** | Coach, text, 25 words max | One thing that improved, one thing to fix, one action: "Index is now inside tolerance. Ring still lags: next set, curl it first." | `/coach/hint` (LLM may rephrase). |
| **At stage change** | One line, celebratory and factual | "The strings are cut. Now without the ghost." | Stage machine (no LLM). |
| **End of session** | `POST /coach/plan`, 60 words max | Summary, 1 to 4 drills, and a `master_note` for the master dashboard. | Existing endpoint. Input: the session's attempts. |
| **Review day** | One line | "Three steps due. One blind try each." | `next_due`. |

Avoid: praise inflation after every rep, long numeric dumps, advice that contradicts the live colours, and coach speech during motion (a second feedback channel competing with the learner's attention; my judgement).

## 6. Data model delta (minimal)

Design: store only **attempts**, and **derive** progress. This keeps one source of truth and survives a change of thresholds.

```ts
type Stage = 'strings' | 'ghost' | 'blind';
type AttemptKind = 'practice' | 'review' | 'test';
type Rank = 'apprentice' | 'journeyman' | 'sealed';

// NEW: one stored record per rep. ScoreResult already exists.
interface Attempt {
  id: string;
  learner_id: string;          // device id is enough for the hackathon, no auth
  lesson_id: string;
  step_id: string | null;      // null for the full run and the duel
  stage: Stage;                // what help was on during the rep
  kind: AttemptKind;
  score: ScoreResult;
  at: string;                  // ISO 8601
}

// NEW: derived from attempts (cached, never the source of truth).
interface StepProgress {
  step_id: string;
  stage: Stage;                // current stage
  clean_streak: number;        // consecutive clean reps at the current stage
  failed_sets: number;         // consecutive failed sets at the current stage
  mastered_at: string | null;  // first time the blind rule was met
  box: 0 | 1 | 2 | 3 | 4;      // spaced review box
  next_due: string | null;     // ISO date
}

// NEW: derived.
interface LessonProgress {
  lesson_id: string;
  rank: Rank;
  steps: StepProgress[];
  days_practised: string[];    // 'YYYY-MM-DD'
  test_best: number | null;    // best duel overall
  sealed: { by: string; at: string; blind_score: number } | null; // by = Lesson.master_name
}

// OPTIONAL additions to existing contract types (all have defaults).
interface Step   { /* ... */ pass_score?: number; clean_reps?: number }  // default 80 and 3
interface TestSpec { /* ... */ pass_score?: number }                      // default 80
```

Endpoints (all optional for the hackathon, since localStorage works):

- `POST /attempts` stores an `Attempt`.
- `GET /progress/{lesson_id}?learner_id=` returns `LessonProgress`.
- `GET /reviews/due?learner_id=` returns due steps.

`CoachPlanRequest.attempts` (`{step_id, score}`) already fits an `Attempt` list, so the coach needs no change. A master dashboard ("where learners struggle") is a group-by on `Attempt` by `step_id` and `worst_finger`, a later bonus.

## 7. Hackathon scope

### Build tomorrow (rough hours, one developer on the frontend, backend untouched)

1. **Stage machine per step** (strings, ghost, blind) driven by the existing live coach and `/score`: clean-rep counter, advance on 2 clean reps, drop on 2 failed sets. About 3 h.
2. **Attempt log in localStorage with derived `StepProgress` and rank** (pure functions, unit-testable). About 2 h.
3. **Combo counter and the "strings snap" animation** tied to the clean-rep counter. About 1.5 h.
4. **Rank chips and the Master's Seal card** (Apprentice, Journeyman, Sealed; shows master name and date). About 1.5 h.
5. **Post-set coach line** from `/coach/hint`, plus session wrap-up from `/coach/plan`. About 1 h.
6. **Tie the duel (`TestSpec`) to the seal.** Pass threshold and result screen. About 1.5 h.
7. **"Today" screen** with the due review and the new step; seed history so a review is "due". About 1 h.

Total about 11 to 12 hours, fits one day with slack. If time runs short, drop 7, then 4 (keep rank as text).

### Show in the demo (3 minutes)

1. A learner starts the table tennis grip step: ghost plays, strings on, fingers glow.
2. Three clean reps: strings fray and snap, stage becomes ghost, then blind (a one-line coach message).
3. Blind pass: step mastered, combo flash, rank moves toward Journeyman.
4. Open a seeded "tomorrow" state: a due review, one blind rep passes, step turns sealed (state transition, not a real wait).
5. Duel against the bot (piano play-along as a second skill if time), then the Master's Seal appears with the master's name. This shows the whole pipeline in one story and shows the platform is general.

### Mention only (roadmap)

- Real half-life regression or Birdbrain-style per-learner difficulty.
- Adaptive tolerance (tighten after mastery), challenge-point automation.
- Leagues, guild-wide leaderboards, social duels over the network.
- Master dashboard of learner struggle (the `Attempt` data enables it).
- Evidence of learning outcomes: a field study comparing blind retention at day 7 against video-only learners. Say it is the next step, not a result.

### Honesty notes for judges (my judgement)

- "Seal" means retention on a later day, not a clinical or professional certification.
- The interleaving, testing-effect and gamification evidence is mixed, so the pipeline is evidence-informed, not evidence-proven for gloves.
- Duolingo uplift figures are company claims and lean on their own populations.

## 8. Sources

- Donovan and Radosevich 1999 spacing meta-analysis: https://www.gwern.net/docs/spaced-repetition/1999-donovan.pdf
- Cepeda et al. 2006 distributed practice: https://www.evullab.org/pdf/CepedaPashlerVulWixtedRohrer-PB-2006.pdf
- Contextual interference retention meta-analysis (2024): https://pmc.ncbi.nlm.nih.gov/articles/PMC11237090/
- Contextual interference transfer meta-analysis: https://pubmed.ncbi.nlm.nih.gov/39205981/
- Retrieval practice in motor learning (Boutin et al.): https://hal.archives-ouvertes.fr/hal-01662870
- Guadagnoli and Lee 2004 challenge point framework: https://experts.mcmaster.ca/scholarly-works/1313883
- Errorless motor learning systematic review 2026: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1722743/full
- Duolingo half-life regression: https://blog.duolingo.com/how-we-learn-how-you-learn and https://preview.aclanthology.org/fix_video/P16-1174.pdf
- Duolingo Birdbrain: https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain
- Duolingo streaks (engineering blog): https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals
- Duolingo retention interview: https://www.lennysnewsletter.com/p/duolingo-streaks
- Melodics practice mode: https://support.melodics.com/en/articles/6777027-practice-mode
- Melodics vs Yousician: https://melodics.com/blog/melodics-vs-yousician
- Yousician practice vs play: https://support.yousician.com/hc/en-us/articles/201558362-Practice-vs-Play-mode-Guitar-
- Khan Academy mastery levels: https://support.khanacademy.org/hc/da/articles/360007253831-What-is-self-paced-Mastery
- Beat Saber generalisation thesis: https://openaccess.wgtn.ac.nz/articles/thesis/Complex_Perceptual-Motor_Learning_in_Virtual_Reality_Investigating_the_Generalization_of_Complex_Motor_Sequences/29631953
- Beat Saber in children with DCD (JMIR 2026): https://games.jmir.org/2026/1/e84995/PDF
- Gamification meta-analysis (ETR&D 2020): https://link.springer.com/10.1007/s11423-020-09807-z
- Feedback science already covered: see `research/02_hand_training.md`.

## 9. Gaps

- Not verified: Brilliant, Simply Piano and Flowkey internals, Duolingo hearts and leagues evidence, the exact Khan 80 percent goal, and a specific physiotherapy exergame review on motion feedback alone.
- Gamification element-level claims come from search summaries, not the primary papers. Check Sailer and Homer (2019) before quoting.
- Motor-skill testing-effect evidence is small. The pipeline uses blind attempts as a measure, not as a promised booster.
