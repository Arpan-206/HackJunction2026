# Robot policy: a simulated Dex3-1 hand performs a lesson on its own

Status, Sun 15 Nov 2026, 02:10 Helsinki: done. Over all held-out takes, the policy beats plain replay and replay sent early in every test, in both simulators. The Verda GPU did not make the policy better than the laptop did. Nothing ran on a real hand. Every Verda container of this work is deleted.

This work is standalone. It is in `robot_policy/`. The live app does not use it, and it changes no file of the live app.

## The short answer

| Question | Answer |
| --- | --- |
| Does the policy perform a held-out take on the simulated Dex3-1 on its own? | Yes, in two simulators. See the video. |
| Does it beat plain replay? | Yes. RMS error 2.13 against 6.12 degrees from a normal start, 3.73 against 6.88 from a random pose, 3.78 against 7.25 with pushes. |
| Does it beat the stronger baseline, replay sent early? | Yes, by less: 2.13 against 2.44, 3.73 against 4.02, 3.78 against 4.6 degrees. From a normal start it wins in 79.1% of the rollouts, not in all. |
| Does it recover when pushed? | Yes, and better than both baselines. In the time from a push to 0.5 s after it, the error is 7.11 degrees, against 10.05 for plain replay and 8.87 for replay sent early. The servos themselves also bring a pushed joint back, so replay recovers too, only later. |
| Was the Verda GPU needed to train it? | No. The laptop CPU trained the same network in 44 s, and that policy scores the same. The GPU's real contribution is the 40 times larger evaluation. See "Laptop against GPU". |
| Did anything run on a real robot hand? | No. |

## Words

| Word | Meaning here |
| --- | --- |
| Take | One real recording of the expert's gloved hand: 18 angle values over time. |
| Retarget | The fixed map from the 18 glove angles to the 7 joint targets of the Unitree Dex3-1 robot hand (`core/robot.py`). |
| Reference | The joint targets over time that the robot hand must follow. |
| Servo | The motor controller of one joint. It pulls the joint toward the commanded angle. |
| Plain replay | The baseline. The reference goes to the servos as it is. Nothing looks at where the hand really is. |
| Replay sent early | A stronger baseline. The reference goes to the servos a fixed time early, to cancel the servo's lag. |
| Policy | A small neural network. It reads the hand's angles and speeds and the next 160 ms of the reference. It sends its own joint commands 50 times a second. |
| Rollout | One simulated run of one hand from start to end. |
| RMS error | Root mean square of the angle error over all 7 joints and all moments of a rollout, in degrees. Lower is better. |
| Push | A torque on 1 to 3 joints for 0.1 to 0.4 s, from outside. It stands for a knock on a finger. |

## Data

The expert's takes come from the two live sessions with the real Rokoko gloves on 14 Nov 2026 (from 13:19 and from 22:21, Helsinki time). They are the takes the user archived in `logs/archive-fresh-2318/`. All are right-hand takes.

| Item | Value |
| --- | --- |
| Real takes used | 27 (289 s) |
| Takes left out | 2, made at 08:22 before the first glove session. We cannot show that a real glove made them. |
| Training takes | 19 (211.7 s). The policy never sees them as they are. They are only the source of the generated variations. |
| Held-out takes | 8 (77.8 s). No part of the training reads them. Every result below is on these takes, unchanged. |

Takes per lesson step:

| Lesson step | Training takes | Held-out takes |
| --- | --- | --- |
| Surgical grips, scalpel pencil grip | 9 | 1 |
| Crochet, hold | 6 | 4 |
| Piano, hand position | 3 | 2 |
| Table tennis, shakehand grip | 1 | 1 |

The held-out takes are other recordings of the same lesson steps. So the test asks: can the hand perform a take of a known lesson that it has never seen? It does not test a lesson that is new in every way.

### Generated variations

Each training take gives 300 variations (`robot_policy/common.py`, `variation`). A variation changes three things, as the request said:

| Change | Range |
| --- | --- |
| Timing | Whole-take speed from 0.6 to 1.6, and a slow local stretch of up to 25%. |
| Noise | White noise up to 1.5 degrees and a slow drift up to 4 degrees on every glove angle. |
| Hand size | A glove on a larger or smaller hand reads another range. Each finger's flexion gets a gain from 0.8 to 1.2 and an offset up to 6 degrees. The finger spreads get a gain from 0.8 to 1.2. |

The retarget runs after the variation. It is the core's own retarget, exported as a matrix. `prepare.py` checks the matrix against `core.robot.Retargeter` on every real frame (largest difference 0 rad).

## The simulated hand

The Dex3-1 has 7 joints: three in the thumb, two in the index finger, two in the middle finger. It has no ring or little finger. The joint limits, effort limits, speed limits, link masses and link inertias come from the URDF in `models/robots/dex3_1/`.

There are two simulators. The policy trains in the first. The second is a check that the result is not a quirk of the first.

| | Batched simulator (`common.physics_step`) | MuJoCo (`mujoco_check.py`) |
| --- | --- | --- |
| Use | Training and evaluation, on the laptop CPU and on the GPU | Second evaluation and the video, on a CPU |
| Hands at once | 32,768 in training, 20,000 in evaluation (GPU run) | 200 |
| Joint dynamics | Each joint alone: inertia, viscous friction, dry friction, a constant bias torque | The whole hand as rigid links from the URDF: gravity, and the forces one link puts on the next |
| Servo | Position servo: torque = kp x (command - angle) - kd x speed, limited to the URDF effort | The same law, as a MuJoCo position actuator |
| Limits | Joint, speed and effort limits of the URDF | Joint and effort limits of the URDF |
| Command delay | 0, 20 or 40 ms, drawn per rollout | The same |
| Physics step | 1 ms | 1 ms |
| Contact | None | None |

Both simulators lack these things, so no result here says anything about them:

- Contact. The URDF's mesh files are not in the repo. The links cannot touch each other, an object or a table.
- The palm's motion. The palm is fixed in the air.
- Cables, backlash and motor heat.
- A real hand. Nothing here ran on a real Dex3-1.

Values that are assumptions, not measurements:

| Value | What we used | Why it is an assumption |
| --- | --- | --- |
| Servo gains | kp 1.5, kd 0.1 as the centre | We recall these from Unitree's example code. We could not check them on a real hand. |
| Rotor and gearbox inertia | 1e-4 kg m2 per joint | The URDF does not give it. |
| Friction and bias torque | See the ranges below | The URDF does not give them. |

Because of this, every rollout draws its own hand. The policy must work on all of them:

| Value | Range per rollout |
| --- | --- |
| kp | 1.0 to 2.2 (and 10% more or less per joint) |
| kd | 0.06 to 0.16 (and 10% more or less per joint) |
| Joint inertia | 0.5 to 2.5 times the URDF value plus rotor term (MuJoCo: rotor term 0.3 to 3 times) |
| Viscous friction | 0.002 to 0.03 N m s/rad |
| Dry friction | 0 to 0.04 N m |
| Bias torque (batched simulator only; MuJoCo has real gravity) | -0.04 to 0.04 N m |
| Command delay | 0, 20 or 40 ms |
| Sensor noise on what the policy reads | 0.3 degrees and 0.05 rad/s |

## The policy and its training

| Item | Value |
| --- | --- |
| Network | 3 hidden layers of 128, 45,703 weights |
| Reads | 7 angles, 7 speeds, the reference now and at 8 future steps (160 ms), its own last 2 corrections |
| Sends | The reference plus a correction of at most 0.7 rad per joint, 50 times a second |
| Method | The batched simulator is written in torch. So the tracking error can be differentiated back through the physics to the network's weights. This is called an analytic policy gradient. It needs no reward design and no trial noise. |
| One training rollout | 1.2 s (60 control steps) from a random place in a random variation |
| Starts in training | 60% near the reference, 40% anywhere inside the joint limits |
| Pushes in training | Half of the rollouts get one push: 1 to 3 joints, 0.4 to 1.5 N m, 0.1 to 0.4 s |
| Loss | Huber on the angle error: squared up to 3 degrees, linear above. Plus a small cost on jumps in the command. |

One detail matters for the method. The dry friction term acts in the forward pass only. Its slope near zero speed is steep, and with it the gradient through 1,200 physics steps grew without limit (we measured an infinite gradient norm at a 0.6 s horizon).

A first training run used the plain squared error. It was replaced, for one reason: the large errors of a wrong start or a push then drown the small errors of normal tracking. We did not evaluate that first run on the held-out takes, because its evaluation stopped on a code error, and by then we had also removed the two takes of unknown origin. Its numbers are not in this document.

## The two baselines

1. **Plain replay.** The request names it. The servos get the recorded targets as they are.
2. **Replay sent early.** We added it to be fair. A servo lags, so plain replay is always late. Sending the same targets a fixed time early removes most of that lag with no learning at all. The lead time is chosen on the training variations only: 100 ms gave the lowest error. A policy that only learnt "send it early" would not beat this baseline.

## Results on the held-out real takes

### Batched simulator, GPU-trained policy, 20,000 rollouts per take and test

| Test | Rollouts per system | Policy (deg) | Plain replay (deg) | Replay sent early (deg) | Rollouts where the policy beats plain replay | Rollouts where the policy beats replay sent early |
| --- | --- | --- | --- | --- | --- | --- |
| Start on the reference, no push | 160,000 | 2.13 | 6.12 | 2.44 | 99.97% | 79.1% |
| Start in a random pose | 160,000 | 3.73 | 6.88 | 4.02 | 99.96% | 85.9% |
| Three pushes per rollout | 160,000 | 3.78 | 7.25 | 4.6 | 99.99% | 97.2% |

RMS error in degrees over all joints and all moments. A rollout "beats" a baseline when its own RMS error is lower on the same hand, the same start and the same pushes.

| Recovery measure | Policy | Plain replay | Replay sent early |
| --- | --- | --- | --- |
| Random pose: median time until every joint stays within 5 degrees (s) | 0.38 | 0.68 | 0.44 |
| Pushes: RMS error from push start to 0.5 s after its end (deg) | 7.11 | 10.05 | 8.87 |
| Pushes: median largest error of one joint in that time (deg) | 35.0 | 43.8 | not measured |

A push of up to 1.5 N m is stronger than six of the seven motors (1.4 N m). So no controller can hold the joint during the push. The gain is in the return.

### Per held-out take, batched simulator

Each cell: policy / plain replay / replay sent early, RMS error in degrees.

| Take | Lesson step | Seconds | Normal start | Random pose | Pushes |
| --- | --- | --- | --- | --- | --- |
| `9c90d77fabdb` | Surgical grips, scalpel pencil | 13.7 | 2.68 / 6.85 / 2.9 | 3.61 / 7.29 / 3.85 | 3.75 / 7.61 / 4.43 |
| `f09f617ee76d` | Crochet, hold | 6.5 | 1.56 / 5.09 / 1.95 | 4.47 / 6.66 / 4.73 | 4.17 / 6.88 / 5.01 |
| `016a1da374c1` | Crochet, hold | 6.9 | 2.08 / 6.52 / 2.44 | 4.41 / 7.61 / 4.73 | 4.25 / 7.98 / 5.21 |
| `a4de6f1e3ba8` | Crochet, hold | 6.9 | 2.25 / 6.5 / 2.47 | 4.69 / 7.72 / 4.89 | 4.35 / 7.98 / 5.25 |
| `1754a2f74d3d` | Crochet, hold | 6.5 | 2.42 / 6.18 / 2.42 | 4.57 / 7.35 / 4.7 | 4.5 / 7.76 / 5.29 |
| `2da6252cc125` | Piano, hand position | 12.8 | 1.29 / 4.96 / 1.97 | 2.87 / 5.59 / 3.33 | 2.97 / 6.03 / 3.96 |
| `7a4d1c8fb139` | Piano, hand position | 6.0 | 1.5 / 4.82 / 1.86 | 3.94 / 6.16 / 4.26 | 4.32 / 6.9 / 5.3 |
| `88955f73ea1c` | Table tennis, shakehand grip | 18.5 | 2.35 / 6.64 / 2.67 | 2.9 / 6.89 / 3.25 | 3.23 / 7.22 / 3.91 |

The policy is ahead in every row but one. In take `1754a2f74d3d` from a normal start, the policy and replay sent early tie at 2.42 degrees.

### MuJoCo 4.0.1, GPU-trained policy, 200 rollouts per take and test

The policy never trained in this simulator. Every rollout has its own hand values, drawn as in training.

| Test | Rollouts per system | Policy (deg) | Plain replay (deg) | Replay sent early (deg) | Rollouts where the policy beats plain replay | Rollouts where the policy beats replay sent early |
| --- | --- | --- | --- | --- | --- | --- |
| Start on the reference, no push | 1,600 | 2.02 | 6.05 | 2.23 | 100.0% | 73.4% |
| Start in a random pose | 1,600 | 3.73 | 6.92 | 4.06 | 100.0% | 90.1% |
| Three pushes per rollout | 1,600 | 3.78 | 7.31 | 4.67 | 100.0% | 96.7% |

MuJoCo gives the same order in every test: policy, then replay sent early, then plain replay. The joint inertias MuJoCo computes from the URDF, with the assumed rotor term, are 1.23e-04, 2.96e-04, 1.18e-04, 2.96e-04, 1.18e-04, 2.96e-04, 1.18e-04 kg m2.

### Laptop against GPU

The same network was trained twice, with the same code, data rules and loss. Both policies then ran through the same laptop evaluation: the same hands, starts and pushes.

|  | Laptop CPU | Verda GPU (1x H100) |
| --- | --- | --- |
| Parallel hands in training | 256 | 32,768 |
| Updates | 200 | 1,200 |
| Generated variations | 152 | 5,700 |
| Training rollouts | 51,200 | 39,321,600 |
| Training time | 44 s (0.7 min) | 1828 s (30.5 min) |
| Evaluation rollouts, batched simulator | 72,000 (two policies, 36,000 each) | 1,440,000 (one policy) |
| Evaluation time, batched simulator | 137 s (2.3 min) | 278 s (4.6 min) |
| Evaluation rollouts, MuJoCo (CPU in both cases) | 14,400 in 7.6 min (laptop-trained policy) | 14,400 in 14.4 min on the container's CPU (GPU-trained policy) |
| GPU minutes billed | 0 | 91.8 (all starts, with the runs we threw away) |
| Cost | 0 | 8.83 USD at 5.77 USD per hour |

Both policies in the same laptop evaluation (36,000 rollouts each; RMS error in degrees):

| Test | Laptop-trained policy | GPU-trained policy | Plain replay | Replay sent early |
| --- | --- | --- | --- | --- |
| Start on the reference, no push | 2.06 | 2.12 | 6.1 | 2.43 |
| Start in a random pose | 3.72 | 3.76 | 6.9 | 4.05 |
| Three pushes per rollout | 3.73 | 3.77 | 7.24 | 4.59 |

Both policies in MuJoCo (CPU; RMS error in degrees):

| Test | Laptop-trained policy | GPU-trained policy | Plain replay | Replay sent early |
| --- | --- | --- | --- | --- |
| Start on the reference, no push | 1.92 | 2.02 | 6.05 | 2.23 |
| Start in a random pose | 3.68 | 3.73 | 6.92 | 4.06 |
| Three pushes per rollout | 3.72 | 3.78 | 7.31 | 4.67 |

What this says, plainly:

1. **The GPU did not improve the policy.** The GPU run used 768 times more training rollouts and 42 times more time. Its policy is not better: it is 0.04 to 0.06 degrees worse in the same laptop evaluation. A network of 45,703 weights does not need a GPU. The laptop trained it in 44 s.
2. **The GPU's contribution is the size of the evaluation.** 1,440,000 rollouts (3,884 hours of simulated hand time) in 4.6 minutes, 40 times the laptop's 36,000 per policy.
3. **The larger evaluation did not change the answer.** The GPU-trained policy scores 2.12 (laptop) and 2.13 (GPU), 3.76 (laptop) and 3.73 (GPU), 3.77 (laptop) and 3.78 (GPU) degrees in the three tests. The laptop evaluation was already enough to see the result.
4. **We did not measure** how long the laptop needs for 1,440,000 rollouts, so we make no speed claim for the GPU.
5. The policy file in the repo, `robot_policy/out/policy.pt`, is the GPU-trained one. The laptop-trained one is `policy_laptop.pt`. Either can be used.

## Rollouts, GPU minutes and cost

| Item | Value |
| --- | --- |
| Training rollouts on the GPU (the kept run) | 39,321,600 of 1.2 s each |
| Simulated hand time in that training | 13,107 hours |
| GPU time of that training | 30.5 min |
| Evaluation rollouts on the GPU | 1,440,000 (8 takes x 3 tests x 3 systems x 20,000) |
| GPU time of that evaluation | 4.6 min |
| MuJoCo rollouts | 28,800 on CPU |
| GPU minutes billed, all container starts | 91.8 |
| Cost at list price | 8.83 USD |
| Verda product | One Serverless Container, 1x H100 80 GB, 5.77 USD per hour. GPU instances do not start on the coupon balance. |

The billed minutes are more than the two GPU times above. The rest went to: a first training run that we threw away (squared-error loss, and two takes of unknown origin still in the data), a second one stopped after 5 minutes for the same data reason, two short test jobs, the waits between jobs, and the MuJoCo check, which used the container's CPU while the GPU sat idle.

Container starts and stops (`robot_policy/out/cost_log.jsonl`):

| Stopped (UTC) | Minutes | USD |
| --- | --- | --- |
| 23:02 | 26.4 | 2.54 |
| 00:08 | 65.4 | 6.29 |

## The video

`robot_policy/out/policy_demo.mp4` (1.3 MB, 13.7 s). It shows the held-out take `9c90d77fabdb-right` (surgical grips, scalpel pencil grip, 13.7 s) in MuJoCo.

| Part | What you see |
| --- | --- |
| Left | Plain replay |
| Right | The policy alone. No recorded command reaches its servos unchanged. |
| Gold, see-through | The expert's take, retargeted: where the fingers should be |
| Start | Both hands start in the same wrong pose, drawn at random inside the joint limits |
| At 4.0 s and 8.5 s | The same push on both hands, for 0.34 s. The pushed links turn red. |
| Number at the top | The RMS error of that hand at that moment |

In this one rollout the RMS error over the whole take is 4.83 degrees for the policy and 8.07 degrees for plain replay.

The capsules are drawn from the joint positions. They are not the real shape of the Dex3-1, because the mesh files are not in the repo. This MuJoCo hand has the nominal servo values, so the video is one rollout, not a statistic.

## What this does not show

1. Nothing ran on a real Dex3-1. The servo gains and the rotor inertia are assumptions.
2. There is no contact. A lesson that holds a tool is only followed in the air.
3. The retarget's signs are unverified against Unitree's own renderer (the note in `config.toml`, `[robot.retarget]`). An error there would mirror a joint in the simulation and on a real hand alike. It would not change the comparison between the policy and replay.
4. The glove gives 18 angles and the Dex3-1 has 7 joints. The ring and little fingers are dropped by the retarget, as in the live app.
5. The held-out takes are other takes of lesson steps that are also in the training set. A lesson that is new in every way was not tested.
6. The policy's gain over replay sent early is real but small from a normal start (2.13 against 2.44 degrees). A simple fixed lead gives most of the gain over plain replay. The policy's clear advantage is after a wrong start or a push.

## How to run it

The exact commands are in `robot_policy/README.md`. The tests are in `tests/test_robot_policy_standalone.py`. They check that training never reads a held-out take, that the held-out takes come from a live glove session, that the exported retarget equals the core's, and that the folder imports nothing from the live app.
