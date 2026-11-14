---
version: 1
slug: "design-apprentice-canvas"
primary_target: "design/apprentice-canvas"
related_targets: []
---

# Surface brief: Apprentice app screens (design canvas)

Scope: Operate mode. App screens for Apprentice, shown on a laptop driving a projector at Junction 2026 (Renaissance-themed hackathon). Masters first: Studio (capture), Assay (verify and publish), Bottega (marketplace), Training (piano), Duel (table tennis), Ledger (master dashboard).

Audience and job: masters capture a hand skill with Rokoko Smartgloves II, verify it, publish it and see where learners fail; learners train against the master's ghost hand. Judges watch from 1 to 3 m.

Constraints: user-pinned theme is the Renaissance (the hackathon theme). Standard web navigation and controls. 3D hands in Three.js. Demo numbers are synthetic and labelled; prices and earnings are placeholders.

## Direction contract

THESIS: The Renaissance bottega, where apprentices learned a craft at the master's elbow, rebuilt around glove data. It refuses the category default: a near-black "holographic hand" tech HUD with a neon accent.

OWN-WORLD: Lapis ultramarine shell (the costliest pigment, kept for what matters), cool lime-plaster work surfaces, 3D stage on carta azzurra (the blue-grey paper Renaissance draughtsmen drew on). Master ghost hand in white-chalk heightening, learner hand in black chalk. Gold leaf only for verified and mastery. Vermilion only for corrections, malachite for correct. Type: Cinzel inscriptional capitals for screen titles and big numerals, EB Garamond italic (Aldine italic, a Venetian invention) for annotations, Alegreya Sans for UI.

STORY: A master sees their hand rendered like a Leonardo study, records takes, earns the guild seal and publishes. A learner sees exactly which finger is wrong, corrected in the margin like a notebook page.

FIRST VIEWPORT: Studio. Lapis left rail (Bottega, Studio, Training, Duel, Ledger; glove status at the bottom). Header with lesson title and a Capture, Assay, Publish stepper. A big carta azzurra 3D stage with the master's hand animating, construction circles on the joints, REC timer and take count. Under it, five finger-flexion lanes split into named steps. Right column: takes with consistency, calibration, gloves, primary "Record take".

FORM: user-pinned Renaissance bottega, overriding the roll; seed: afdb5e85b24bcb5a. Signature move: Leonardo-notebook annotation, a vermilion hand-drawn ring that tracks the faulty finger live in 3D, with an Aldine-italic margin note and a numbered callout.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
