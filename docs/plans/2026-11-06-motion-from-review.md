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

### Batch B: fix

`npm run motion-measure` ends with each gate's pass or fail, per example. Gaits are measured at each example's
own walk and run speeds (below), where batch A used 1.1 and 3 m/s for all.

#### Gates, before and after

| Gate | Example | Before (batch A) | After |
|---|---|---|---|
| Runs lean forward (chest per cycle, 3D / side exact / side pixels, degrees) | knight | -3.5 / -3.6 / -6.4 | 18.2 / 18.5 / 19.1 to 19.4: pass |
| | rogue | 0.7 / 0.7 / -1.8 | 18.2 / 18.3 / 13.8 to 14.0: pass |
| | dwarf | 2.4 / 2.4 / -0.1 | 18.2 / 18.3 / 14.3 to 14.7: pass |
| | wizard | 3.2 (-3.3 to 7.3) / 3.2 / 1.4 | 18.2 / 18.3 / 16.1 to 16.3: pass |
| No limp, walk (length / duration gap, worst cycle; mean in brackets) | knight | 13.8 / 24.0 | 1.7 / 22.2 (0.5 / 12.0): **fail** |
| | rogue | 61.8 / 60.9 (41.2 / 29.0) | 5.4 / 9.5 (2.8 / 7.9): pass |
| | dwarf | 5.4 / 11.8 (3.3 / 3.4) | 2.2 / 10.5 (1.5 / 4.5): **fail** |
| | wizard | 5.4 / 0.0 | 1.4 / 6.9 (1.0 / 3.4): pass |
| No limp, run | knight | 19.9 / 40.0 | 2.4 / 0.0 (2.3 / 0.0): pass |
| | rogue | 29.3 / 13.3 | 1.2 / 13.3 (1.0 / 4.4): **fail** |
| | dwarf | 28.5 / 13.3 | 2.4 / 15.4 (1.0 / 6.6): **fail** |
| | wizard | 13.5 / 57.1 (8.6 / 20.3) | 3.2 / 10.5 (1.4 / 7.9): **fail** |
| Idles breathe (pelvis-to-chest travel per breath, % of height; weight share range, points) | knight | 0.0; 5.0 | 1.2; 40.6: pass |
| | rogue | 0.0; 0.1 | 1.2; 35.1: pass |
| | dwarf | 0.0; 0.1 | 1.2; 31.3: pass |
| | wizard | 0.0; 0.4 | 1.2; 35.9: pass |
| Still control (layer off) fails both | all four | | 0.0; 5.0, 0.1, 0.1, 0.4: fails both, pass |
| Walks walk (walk takes, % of frames) | knight | 100 (walk, walk-start) | 100 (walk alone): pass |
| | rogue | 7 | 100 (walk alone): pass |
| | dwarf | 0 | 100 (walk alone): pass |
| | wizard | 100 (walk, walk-start) | 100 (walk alone): pass |
| Attacks suit | knight | punch | swing (`attack-swing`, default: carries a sword): pass |
| | rogue | punch | punch (default: empty hands): pass |
| | dwarf | punch | swing (`attack-swing`, default: carries an axe): pass |
| | wizard | punch | cast (`attack-cast`, composed; named in `character.json`): pass |

The breath before is the restated measure (the pelvis-to-chest distance), 0 with batch A's rigid spine. Walk and run
are measured at each example's own speeds, batch A's at 1.1 and 3 m/s for all.

**No limp misses on duration, five of eight; left unchanged.** The gate is read as written, every cycle; every length
gap passes (worst 5.4%). The gate as written cannot pass for runs at 24 fps: a run step is 6 to 8 frames, so one frame
is 13% to 15% of a step, and any cycle whose left and right steps differ by one whole frame misses the 10% bound; it
passes only if every cycle's two steps have exactly equal frame counts. A walk step is 10 to 14 frames (one frame is
7% to 10%), which the gate can pass. The five misses (worst cycle, duration gap) are one-frame differences, as the
loop's two steps fall on different whole frames when playback stretches to the body's speed. The mean duration gaps
of the five: knight walk 12.0%, dwarf walk 4.5%, rogue run 4.4%, dwarf run 6.6%, wizard run 7.9% (the other three
means are 0.0% to 7.9%: knight run 0.0%, rogue walk 7.9%, wizard walk 3.4%). The four run means (4.4% to 7.9%) are
quantisation, not a limp; the gate is not loosened for them. The knight's walk is the exception: its left step is
systematically longer (12.0% mean, worst 22.2%), a real asymmetry left open: its rig rests with the right foot 7 cm
forward and the right toe turned out, and the cycle's mirror re-aims the legs but the feet's rest shapes differ, so the
two feet are held at different moments. The cause is in where the player starts and ends a hold, not in the take.
The lean passes, the knight's pixel view at 19.1 to 19.4 degrees, inside the bound by less than one pixel's step (about
4 degrees). The human review gate is batch C's.

#### What changed

- **Run loop and intents** (`cycle.ts`, `database.ts`, `player.ts`). The steady takes (`walk`, `walk-2`, `run`, marked
  `loop` in `takes.json`) are looped on one stride, closed in pose space and made symmetric: each frame averaged with
  the mirror of the frame half a cycle away, on an even number of frames. Stopping takes (`brake`) are matched only
  while the commanded speed is below the body's by 0.1 m/s, turning takes (`turn`, over 45 degrees) only while the
  commanded heading is 0.2 rad off, and starting takes (`start`) only while it is above by 0.1 m/s; both options of
  the brief, since the loop alone still hopped into `walk-turn-left` every 80 frames and the dwarf into `walk-start`.
  Steady walks and runs play their loop alone; a stop still brakes into a stopping take (a test holds both).
  Symmetry is what evens the lengths: the capture's two steps differ by 10%.
- **The torso carries its lean** (`retarget.ts`, `humanoid.json`): `span` places the chest along the source spine
  from `lowerback` to `thorax`. Retargeted chest pitch of the run take: 6.3 before, 15.2 after (raw neck 13.4); the
  torso follows each take's spine, so most takes lean further forward (walk -0.4 to 4.7, `run-stop` -5.8 to 2.0,
  crouch 27.6 to 31.6) and the punch less (7.8 to 3.3).
- **Walks walk** (`database.ts`, `player.ts`, `record.ts`, `page/walker.ts`): walk and run speeds by Froude
  similarity, Fr = 0.14 (walk) and 0.94 (run) from the looping takes on the source's 0.84 m leg, and the walking takes
  played at `pace` = sqrt(source leg / character leg) so they are dynamically similar. Walk / run speeds: knight
  0.97 / 2.54, rogue 0.77 / 2.02, dwarf 0.67 / 1.76, wizard 1.03 / 2.70 m/s (all 1.1 / 3 before); paces 1.09, 1.37,
  1.58, 1.03. On the page every character walks at its own speed, slower than 1.1 m/s, and the small ones step faster
  (the dwarf's steps 1.6 times the capture's rate); the export's walk and run are recorded at the same speeds.
- **Idles breathe** (`idle.ts`, `player.ts`): the chest and what hangs from it rise 1.2% of the body's height per
  breath, the arms half as much again, and the body above the knees sways over each foot by 15% of the ankles'
  distance either way; periods are whole idle laps (6.3 s sway, 3.15 s breath), so the exported idle loop is three
  laps of the take (153 frames, from 51) and its window two loops (from four).
- **Attacks** (`formats/attack.ts`, `attack.ts`, `character.ts`, `world/bundle.ts`, `check.ts`): `character.json`
  may name `attack`; the default is swing for a carried weapon part, cast for a carried part named as a staff, else
  punch; `check` prints the attack and why. The database keeps the one attack that suits; attacks are played
  without the style. The wizard's `character.json` names `cast`.
- Player feet (`player.ts`): a held foot pinned flat is pressed back to the ground, and a foot reaching down in a
  fall is kept above the ground under it. Both surfaced as test failures once the walks looped: the wizard's planted
  foot hovered up to 2.1 cm at heel-off (17% of its planted frames), and the knight's trailing foot went 5 cm through a
  ledge's corner. The idle layer fades out over 0.2 s when the idle ends, instead of dropping in one frame.
- Measurement: a stance gap shorter than 3 frames at the very start of a window is closed, so a stance the window
  starts in is not a touchdown (it made a 5-frame first step in the knight's run); a step's length is taken along the
  pelvis's travel between the touchdowns, not the root's heading at the second, which wobbles within a stride; a gap
  is the difference over the absolute mean (a negative mean step had given a negative gap, which passed).

#### Verify

`npm run verify`: typecheck, lint, examples, the browser suite, the rendering panel and the gates pass; the test
step has one failure, below. The rendering panel (28 images) and the gates (21 lines) were accepted as the meant output
change.

- **The dwarf's export** passes every gate.
  - Walk seam (65 against a 62 px median step, 61 against 58). Not the cloak: with the cloak's points removed or frozen
    in the body's frame the same seams fail in the same directions. The seam is an ordinary step of the cycle, and the
    dwarf's walk at its Froude pace is 18 frames a lap (1.6 times the capture's rate), and a mirror-symmetric lap
    repeats its half, so its starts are few phases; none had a step below the median in all eight views (the lowest
    worst ratio over every cut, 400 candidates included, was 1.1). Fixed in the recorder: when no cut passes, the lap
    is recorded again at the speed for one frame more or fewer (up to 12% off the Froude speed); the dwarf's walk
    passes at 20 frames a lap (0.61 m/s against 0.68). The other three examples pass at the nearest lap and are
    recorded as before. Two laps in one loop did not pass.
  - Idle `drawn` / `ground` in the back-right view. Not the weight shift's amplitude: at 15%, 10% and 5% of the ankle
    spacing the same foot is hidden in every frame, and with no shift it is visible; any shift reorders the cloak and
    the foot there, and the painter's hysteresis keeps the order. The skin needed what the wizard's did: a foot `layer`
    in the dwarf's `backSide` view (`examples/dwarf/skin.json`). The amplitude stays.
- **The wizard on `demo-1200`** (a sole 7.5 px under the shelf in the frame before the fall). The cause is the ground
  function's reach, not the foot press or the fall lift (toggling either left the 7.5 px). The body's level follows
  the lowest foot, so a character stepping off a shelf sinks while its trailing foot is still on the shelf; once the
  level is a step (0.2 m) below the shelf top the shelf is out of reach of the ground function, the held foot loses its
  ground, is placed on the floor 4.8 m below and dives through the shelf for a frame. Whether the foot is still down
  at that moment depends on the route's timing at the edge, which the slower Froude walk changed. Fixed in
  `player.ts`: the ground under a sole is asked from the level of the held feet as well as the body's. The test
  passes, and so does every other player and page test.
- **The dwarf's cloak RMS test fails, not changed.** The hem moves 0.0298 m RMS on `demo-1200` seed 3 against at least
  0.03 (the other runs: 0.113 and 0.059; the knight 0.089 to 0.143 and the wizard 0.090 to 0.117 in the same runs).
  The test asks that capes and cloaks swing in a minute of walking. Its quantity is the hem's spread over the walking
  frames, which follows what the route holds (turns, starts and stops), not the speed: with the dwarf's walk speed
  set to 0.67, 0.85 and 1.1 m/s on the same seed the spread is 0.030 (0.111 at 0.6806), 0.043 and 0.086. The miss
  is 0.0002 m over a 60 s walk; the cloak's trail behind the pelvis in the same walk is 0.119 m. A per-speed
  bound would not follow the measurement, and loosening the bound is a decision for the owner, so the test stands as
  written and fails. Open.
- **The rogue's drawn cloth flicker** (1.40% in `demo-1200` seed 3; met before). The gate is the difference between
  the worst frame's flicker with the scarf and without it. In that window, frame 27 re-snaps the whole sprite for
  one frame in both runs (27.25% of its pixels with the scarf, 25.85% without), because the rogue reaches the end of
  a shelf walking west, its leading foot reaches over the edge and the body dips 12 cm in four frames and comes back as
  it turns; the scarf adds 1.4 points to that same frame. It is not the idle layer (the rogue is walking) nor a loop.
  The baseline's worst frame of the same window was 9.6% in both runs: a different route. The gate's two-run
  difference of worst frames is the noise the TODO records for the knight (the knight, dwarf and wizard miss it before
  and after); recorded, not fixed. The dip at a drop-off is the body following the lower foot, which the page world
  designed; changing it is outside this plan.
- **Count gates: accepted regressions.** Characters walk at leg-length speeds by design, so in the fixed 60 s they make
  fewer trips. The dwarf's jump gate counts 39 trips where it needs at least 40 (51 before; met before), and the
  page-test layout plans 3 super jumps where it needs at least 4 (6 before; met before). The gates and the demos'
  durations are unchanged; the open item is in [`TODO.md`](../TODO.md): restate the page's count gates per distance
  travelled, in a plan with gates fixed first.
- **Every changed line of the gates baseline** (21): the planted-feet gate on `page-test`, `perception`, `jumps`,
  `demo-1200` and `demo-390` turns from missed (10, 12, 32, 22 and 28 feet off, worst 1.12 px) to met (0 off), from the
  player pressing pinned feet flat; the rogue's drawn cloth flicker turns from met to missed (above); the dwarf's jump
  gate and the `page-test` super jumps turn from met to missed (above). Missed before and after, with other numbers
  from the changed routes: the knight's, dwarf's and wizard's drawn cloth flicker, the mid-air gate on the five layouts
  (34, 18, 60, 40 and 61 frames before; 38, 24, 48, 21 and 45 after), and the super jumps on `perception` (1 landed of
  1 planned, then 0 of 0). Met before and after, with other counts: the knight's and rogue's jump gates (83 and 63
  trips, then 73 and 54) and the super jumps on `demo-1200` (5, then 9) and `demo-390` (15, then 10). The landing gates
  are unchanged.
- The rendering panel changes in 28 images: the examples' walks, runs and idles (the new loops, symmetry, speeds and
  idle layer), the attacks, and the dwarf's back-right idle.

#### Attack takes: the CMU index

The complete subject index (`mocap.cs.cmu.edu/search.php`, all subjects and motions: 109 subjects, 2435 trials) was
read before anything was downloaded. Candidates:

- Swing: subject 2 trials 7, 8, 9 ("swordplay"); subject 79 trial 1 and subject 80 trial 71 ("chopping wood");
  subject 86 trials 4 and 5 ("... punching, chopping ..."); subject 124 trial 7 ("baseball swing"); subjects 22 and
  23 trial 20 (threatening with a stool).
- Thrust: subject 2 trials 7 to 9 (swordplay); subject 135 trial 9 ("Oiduki", a stepping lunge punch); subject 144
  trials 11, 12, 17, 18 (lunges, exercise).
- Cast: subject 120 trial 3 ("Mickey cast spell"); subject 120 trial 4 ("Mickey conducting").

Fetched: 2/7, 2/8, 2/9, 79/1, 120/3 and 135/9 (and their skeletons). Chosen: 79/1, source frames 200 to 545, as
`attack-swing`: a two-handed overhead chop from a hold, with both feet planted and the root still, through a recovery
to rest. Not chosen:

- 2/7 to 2/9: cuts in a fencing stance with the left foot 27 cm forward and the body turning up to 90 degrees between
  cuts; the stance does not start or end at rest.
- 135/9: each punch steps 0.8 m forward with a 55-degree turn: root motion, which a performance does not play (the
  root stays on the standing body), so the feet would be dragged.
- 120/3: the cast lunges 0.5 m forward with the root dropping 25 cm and steps back after the hold, and each of its
  three casts starts from the previous one's hold. The same root-motion limit rules it out; the cast is composed from
  the idle instead (draw back, strike forward, hold, recover), and so is a thrust.

#### Misses and open points

- The knight's swing reads weakly in the side view: the overhead wind-up hides the sword behind the body for about
  eight frames, and the strike shows as a forward-down cut. The chop is two-handed; the knight's sword is in the right
  hand, so the left hand travels with it.
- Building the databases takes about twice as long (the knight's from 0.34 to 0.65 s), paid once per character
  when the page starts.
- A player told to idle right after standing from a walk (24 frames of matching first) stepped its right foot every
  few seconds in a scratch run with the layer off; started from rest, as the export does, the feet stay planted.
  Whether this predates batch B was not measured.
- Staff detection is by part name (staff, wand, rod, sceptre): the rig marks what is carried, not what it is.

#### Review

An independent review, told to assume the code was wrong, found, each fixed as said: the composed attack's last frame
fell back to the drawn pose, a one-frame jerk (the last frame is the idle's, which the test checks); the no-limp gate
read on the mean instead of every cycle (read as written, which is why it fails above); the idle layer dropping in one
frame (it fades); a thrust on a rig without arms throwing (no composed attack there); the pace ignoring the style's
stride and averaging a turn take's source leg in (the looping takes' leg, over the stride); the span rotation drawing
style variation (span keys are outside the style); intent filtering that could leave no candidate (it falls back to
all); and the skin preview's fixed 1.2 m/s walk (the character's walk speed). Left as stated limits: untagged attack
takes count as punches, other sided joints are reflected rather than swapped by the mirror, and the database build
cost.

Accepted loosening, decided by the plan's owner: the page test "capes, cloaks and the robe swing" required each run's
hem to move at least 0.03 m RMS while walking. At the leg-length walking speed the dwarf's cloak moves 0.0298 m on
one run (`demo-1200` seed 3) and 0.030 to 0.113 m on the others; the reading follows the route and the speed, which
this batch slows on purpose. The test measures the same 0.03 m RMS over the whole minute of walking that its title
names (all calm runs pooled, weighted by walking time), instead of per run; this loosens the per-run reading and is
recorded here as such.
