# Motion From Review

The first human review of the benchmark (eight blind pairs against hand-animated game sprites, Piñata picked in 3)
named four defects, each a fault of the tool for any character, not of one skin:

- runs lean backward (the knight's run);
- a limp (the wizard's run: uneven strides between the legs);
- idles are lifeless and procedural (no breath, no weight shift, no pose with intent);
- one attack for every character (a wizard punches).

## Design

- **Measure first.** Each defect gets a number computed on the recorded motion of every humanoid example and every
  take, before anything is changed: the torso's pitch over a run cycle (positive is forward), the stride of each leg
  (length and duration of each step, left against right), the idle's motion energy (how far the head, chest and hands
  move over the loop, against what a breathing body moves), and which attack each character plays. The numbers show
  whether the cause is the take, its retarget onto the rig, motion matching, or the export's camera.
- **Fix where it lies,** for every character: a take that leans back or limps is corrected in the retarget step or
  replaced by a better take; a cause in matching or the rig is fixed there.
- **Idle with life.** A small layer on top of the idle take: breathing in the chest and shoulders, a slow weight
  shift between the feet, an occasional held look or settle, with amplitudes stated as fractions of body height so
  they scale with any character; cloth and hair respond to it as they do to any motion.
- **Attacks that suit the character.** The behaviour library holds several attacks (punch, swing, thrust, cast); a
  character's `character.json` names its attack, with the tool's default chosen from what the character carries
  (a weapon part, a staff) and stated in `check`. New takes come from the CMU library where it has them; where it does
  not, the [ML proposal](../proposals/ml-augmentation.md)'s take sources (100STYLE, hosted text-to-motion) are the
  next step, not part of this plan.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Runs lean forward | the torso's mean pitch over every run cycle of every humanoid example is forward, between 5 and 20 degrees, in the recorded motion and in the exported side view | a run that leans back fails |
| No limp | left and right strides of every walk and run differ by at most 10% in length and in duration | measured per cycle on planted feet |
| Idles breathe | every idle loop moves the chest relative to the pelvis by 0.3% to 1.5% of body height per breath cycle, and the weight share between the feet ranges over at least 20 percentage points across the loop; a still control (the layer off) fails both | amplitudes from body height, so any character; restated after batch A showed the chest's height alone passes with no layer (the chest is rigid with the pelvis), so the first wording could not fail |
| Walks walk | at each example's walk speed the walk plays walk takes in at least 90% of frames | batch A: the rogue and dwarf walk on run takes 68% to 76% of the time |
| Attacks suit | each example plays the attack its `character.json` or its default names; the wizard casts | |
| Human review | a second blind review round of the same eight moves: Piñata picked in at least 5 of 8, and none of the four named defects named again | the owner's eye, as the first round |
| Every other gate | every export gate and `npm run verify` pass | |
| Existing outputs | change only where these fixes are meant, accepted and named | |

## Batches

- **A. Measure:** the four numbers on every example and take; the causes. Review.
- **B. Fix:** lean and limp where they lie, the idle layer, attacks per character; the gates. Review.
- **C. Review round two:** the blind page again, the owner's verdict. Review.

## Results

### Batch A: measure

`npm run motion-measure` prints every table below (`src/cli/motion-measure.ts`, `src/export/measure.ts`,
`src/motion/measure.ts`; method in [`design.md`](../design.md)). Pitch in degrees, forward positive; walk is exported at
1.1 m/s and run at 3 m/s, the loops are the player's steady state after 144 frames.

#### Torso pitch over a run cycle

| Example | Chest, 3D recorded | Head, 3D recorded | Chest, side view exact | Chest, side view in pixels |
|---|---|---|---|---|
| knight | -3.5 | -0.7 | -3.6 | -6.4 |
| rogue | 0.7 | 2.7 | 0.7 | -1.8 |
| dwarf | 2.4 | 4.4 | 2.4 | -0.1 |
| wizard | 3.2 (-3.3 to 7.3 over cycles) | 4.7 | 3.2 | 1.4 |

Against the gate (5 to 20 degrees forward), none of the four passes; the knight leans back, as seen. The takes:

| Take | Raw neck | Raw head | Retargeted chest (all four examples) | Retargeted head (knight, rogue, dwarf, wizard) |
|---|---|---|---|---|
| run (CMU 16 trial 35) | 13.4 | 7.7 | 6.3 | 8.5, 8.0, 8.3, 7.7 |
| run-stop (CMU 16 trial 57) | 0.2 | -2.7 | -5.8 | -3.6, -4.2, -3.9, -4.4 |
| walk (16 trial 15) | 2.9 | 0.8 | -0.4 | 1.1, 0.7, 0.9, 0.6 |

Where the backward lean comes from:

- **Not the run take, its retarget, the style or the camera.** The retargeted `run` leans 6.3 degrees forward on every
  example (the style amplitudes do not touch the pelvis; with the style off the number is identical), and the exact
  side view equals the 3D pitch to 0.1 degrees: the export camera adds no tilt. The side view in whole pixels is off by
  up to 3 degrees either way (the torso is about 13 px; one pixel is about 4 degrees), which is why the knight's
  drawn lean is -6.4 against -3.5.
- **Motion matching's choice of takes.** The library holds one run take, 33 frames (1.4 s, 3.7 m), and `run-stop`, a
  braking take that leans back (-5.8 retargeted, as low as -12 per frame). A matched run cannot loop on the 33 frames
  (the last 16 are no candidates, since the take does not end at rest), so the player hops into `run-stop` and back.
  Frames played from `run-stop` in the exported run: knight 64%, rogue 31%, dwarf 32%, wizard 31%; the chest pitch of
  those frames is -3.2 to -5.8 against +0.9 to +6.1 for the `run` frames. The knight is the worst because it plays
  `run-stop` most. Commanding other speeds shows `run-stop` in 20% to 50% of frames at every speed from 2 to 3 m/s for
  all four, so it is not a speed mismatch.
- **Smaller, a second cause.** The rig's chest is rigid with the pelvis, so the torso carries only the pelvis's tilt
  (retargeted 6.3) while the raw neck leans 13.4; the spine's other 7 degrees reach only the head. A forward lean the
  take has is therefore drawn at half strength.
- Not measured: the drawn torso's tilt from the drawn parts' own anchors. The side view above uses the same two joints
  through the export camera, snapped to pixels (about the steady anchor's first-frame snap), not the painter's
  anchors, which carry a hysteresis.

#### Stride symmetry

| Take (raw CMU) | Length gap % | Duration gap % |
|---|---|---|
| walk | 4.0 | 7.4 |
| walk-2 | 5.3 | 6.9 |
| run | 5.2 | 10.5 |

Retargeted onto the four examples the duration gaps are unchanged (10.5 for run, 7.4 for walk and walk-2) and the
length gaps are 1.6 to 3.3 for walk, 3.5 to 6.4 for walk-2 and 10.0 to 11.6 for run (5.2 raw): the retarget adds about
5 points to the run's length gap, on a single pair of steps, so that is uncertain. The raw jog is itself at the gate's
edge on duration (10.5%, from three steps). The recorded takes, mean gap per cycle with the worst cycle:

| Example | Walk length / duration | Run length / duration | Run step time, left / right (s) |
|---|---|---|---|
| knight | 13.8 / 24.0 | 19.9 / 40.0 | 0.38 / 0.25 |
| rogue | 41.2 (max 61.8) / 29.0 (max 60.9) | 29.3 / 13.3 | 0.29 / 0.33 |
| dwarf | 3.3 / 3.4 | 28.5 / 13.3 | 0.29 / 0.33 |
| wizard | 5.4 / 0.0 | 8.6 (max 13.5) / 20.3 (max 57.1) | 0.39 / 0.31 |

- **The wizard's limp is motion matching's take changes, not the take or the rig.** The wizard's run is 69% `run` and
  31% `run-stop`; 45% of its steps cross a change of take, and its steps take 0.39 s on one leg and 0.31 s on the
  other, with a worst cycle 57% uneven. Its walk, from `walk` and `walk-start` only, is even (5.4% and 0.0%). The
  retargeted `run` take alone is 10.5% and 11.0% uneven (one pair of steps). The other three have the same run uneven
  by 13% to 40% and are not called limping only because the review did not name them.
- Uncertain: that the limp reads in the drawn feet and not only in the kinematic ankles, and the robe's part in it, are
  not measured; the gaps are of the ankle joints at touchdown.
- A second finding for the walk: at the walk speed of 1.1 m/s the rogue plays `run` 76% of the time and the dwarf 68%
  (`run` plus `run-stop`). Their walk takes scaled to their legs travel at 0.58 and 0.44 m/s (the knight's 0.92, the
  wizard's 1.04), so matching reaches for running takes. The knight's and wizard's walks are 100% of steps across a
  change between `walk` and `walk-start`.

#### Idle motion energy

Per loop period (51 frames, 2.1 s), shares of body height:

| Example | Chest height travel | Per second | Shoulders above pelvis | Head reach / path |
|---|---|---|---|---|
| knight | 0.36% | 0.17% | 4.3% | 4.6% / 59% |
| rogue | 0.57% | 0.27% | 4.3% | 4.3% / 55% |
| dwarf | 0.69% | 0.32% | 4.9% | 5.3% / 67% |
| wizard | 0.72% | 0.34% | 2.0% | 3.7% / 48% |

| Example | Left hand reach / path | Right hand reach / path | Weight share range between feet | Pelvis sway |
|---|---|---|---|---|
| knight | 4.7% / 74% | 5.5% / 99% | 5.0% | 0.53% |
| rogue | 5.3% / 83% | 18.7% / 320% | 0.1% | 0.02% |
| dwarf | 5.4% / 85% | 17.2% / 295% | 0.1% | 0.02% |
| wizard | 4.0% / 62% | 17.4% / 291% | 0.4% | 0.03% |

(Path is over four periods.) Both feet are planted for the whole loop on every example, and the weight share between
them moves 0.1% to 0.4% of the foot span (the knight 5%): no weight shift. The right hand of the rogue, dwarf and
wizard travels 17% to 19% of body height in the take (the knight's style stiffens that arm to 0.35); a fidget, not a
breath.

Consequence for the gate: the chest's travel is 0.36% to 0.72%, already inside 0.3% to 1.5%, so the gate as worded
passes with the layer off and cannot fail its still control. The chest is rigid with the pelvis, so its height is the
pelvis's (knee flex, sway), not breathing. Batch B measures breath at the shoulders relative to the pelvis (4% to 5%
in the take, mostly the thorax's turn) or on a quantity the layer alone sets, and states the gate on that.

#### Which attack each character plays

Every example plays `attack-punch` (CMU 141 trial 14, "punch and kick", frames 60 to 215): the wizard punches. The
character files name no attack and the player has one `attack` take.

| Example | Hand | Peak reach forward | Peak lift above pelvis |
|---|---|---|---|
| knight | handL | 38% | 41% |
| rogue | handR | 43% | 40% |
| dwarf | handR | 43% | 42% |
| wizard | handR | 34% | 38% |

(The knight's sword is in the right hand; the take punches with the left.)

Attack takes in the repository: only `attack-punch`. The CMU library holds, in the one index page already on disk (the
site's result list for "jump", so a partial view): subject 86 trials 1, 2, 3 and 5 ("jumps kicks and punches", "walk,
squats, run, stretch, jumps, punches, and drinking", "walking, running, jumping, kicking, and stretching",
"walking, jumping, jumping jacks, ..., punching, chopping"), subject 56 trials 4 to 7 ("throw punches"), subjects 87,
88 and 90 (kicks), and subjects 33 and 34 (football throws). The chop in 86 trial 5 is the one candidate for a
downward swing; no listed trial is a thrust or a cast. A web search for sword or fencing trials in CMU found none, so
no source of a swing, thrust or cast is confirmed; the complete subject index (`mocap.cs.cmu.edu`, one page per
subject, tens of kilobytes) has not been read and would be read first, with its list stated, before any new take is
downloaded. Local source files exist only for subjects 16 and 69.

#### Causes in short

- Backward lean: motion matching's hops into `run-stop` (the only other running data), with the rigid chest halving the
  take's own lean; not the take, retarget, style or camera.
- Limp: the same hops (steps across a change are uneven; the uninterrupted walk is even); the raw jog is itself
  near 10%.
- Idle: no weight shift (feet planted throughout) and a gate that passes without breath.
- Attack: one take for everyone, no per-character choice.
