# Animation Benchmark

How do Piñata's animations stack up against hand-animated game characters, quality for quality? Not to copy a style,
but to know where we stand on what makes character animation good: fluidity, weight, anticipation and follow-through,
secondary motion, contact with the environment, readability, and appeal. The references are CC-licensed, fully
animated pixel-art characters; the measure is a rubric that judges can be shown to apply reliably, plus numbers the
tool can compute.

## References

Kept outside the repository (a fetch script records each source URL and licence; nothing is redistributed):

- [Fantasy Warrior](https://luizmelo.itch.io/fantasy-warrior) (LuizMelo, CC0): side view, a caped warrior, idle 10,
  run 8, jump 3, fall 3, three attacks, take hit, death. Cape and timing in a side-scroller.
- [Huntress 2](https://luizmelo.itch.io/huntress-2) and [Evil Wizard](https://luizmelo.itch.io/evil-wizard) (LuizMelo,
  CC0): side view, hair and robes.
- [8 Directional 2DHD Character](https://hormelz.itch.io/8-directional-char) (hormelz, CC0): eight directions, walk,
  run, idle, jump, roll, attacks, push, damage, death. Directions and turning.
- LPC characters (CC-BY-SA/GPL, the generator's sheets, already used as the calibration control): four directions,
  walk, slash, thrust, cast, hurt, with cape and hair layers.

## Design

- **The rubric.** Seven dimensions, each a 1-5 rating with a one-line anchor per level: fluidity (spacing and easing,
  no pops), weight (contact, squash, the body settling), anticipation and follow-through, secondary motion (cape,
  hair, cloth lag and settle), environment (feet planted, ground contact, shadows, reactions), readability (pose and
  direction at a glance), appeal (would a player want this character). Plus one overall question: which of the two
  would you ship in a game.
- **Like with like.** Each comparison pairs a reference animation with Piñata's closest one (walk or run with run,
  idle with idle, jump with jump, attack with attack), at the same scale and frame rate, as stacked strips and as
  animated GIFs, both orders.
- **Judge validation first.** Before any score counts, the judges must tell a reference from a degraded copy of
  itself on the dimension the degradation hits. A dimension the judges cannot see is reported and left out of the
  benchmark. A degraded copy changes only its own dimension: its canvas size is the reference's, and its frame count,
  frame rate and total duration are the reference's wherever the dimension allows. What each one changes, and what
  stays equal:
  - Fluidity: every second frame is replaced by the frame before it, so each kept frame is shown for two steps. The
    poses, the canvas, the frame count, the step and the duration are unchanged; only the spacing between distinct
    poses is coarser.
  - Secondary motion (LPC walks, whose cape is a layer): the cape layers are held at the first walk frame while the
    rest walks. The body, the canvas (the reference's crop), the frame count, the step and the duration are
    unchanged.
  - Environment: only the feet region moves, the lowest four pixel rows of the sprite (counted up from the lowest
    opaque row over all frames), every opaque pixel in them. It slides sideways towards the side with more room, by
    the frame index up to four pixels and back down towards the end (0, 1, 2, ... and back to 1 at the last frame),
    so the last frame is one pixel from the first and nothing pops at the loop. The body above the feet region,
    the canvas, the frame count, the step and the duration are unchanged, and no pixel leaves the canvas.
  - Anticipation: only the wind-up frames are removed. The strike is the pair of neighbouring frames with the
    largest share of changed pixels; the wind-up is the frames before the later of the two, at most half the clip.
    The removed steps are given to the strike frame, held for them, so the frame count, the step and the duration
    are unchanged and the clip starts in the strike pose.
  - A clip of one frame has nothing to degrade and is refused.
- **Dimensions a reference lacks are scored in isolation.** The caped warrior, the huntress and the wizard are single
  sprites: no separable cape or hair, and no jump for the wizard. A missing dimension is not skipped; it is scored
  in one of three ways. Piñata's animation is rated alone with the anchors (a single-animation rubric item). It is
  rated against a degraded copy of itself (the cape frozen to its rest pose, the holds removed), which also shows
  whether judges see the dimension on Piñata's art. Or it is measured against a physical expectation (the cape's lag
  behind the body, settle time after a stop, overshoot, foot slide). Secondary motion is scored this way against the
  references, and only the LPC walks, whose cape is a layer, can be degraded for the validation.
- **Numbers beside the ratings.** Computed on both sides: frames per cycle, distinct poses, the share of frames
  that are holds, the largest pixel change between neighbouring frames (pops), the cape's lag behind the body
  (phase delay of its centre of mass), foot slide on drawn pixels. These need no judge and become regression
  numbers.
- **Output: a scorecard.** Per dimension, Piñata's rating against the references', with the numbers; the weakest
  dimensions become the next plans (the feel layer: anticipation, squash, timing, holds).

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Judges see the dimension | for each dimension kept, the reference is rated above its degraded copy in at least 80% of the answers asked for, both orders; an answer not given counts as not above | dimensions below are reported and dropped |
| Controls | a reference against itself: the rating difference between the top and bottom copy, per answer and dimension, averages at most 0.5, and no control answer is missing | the rubric is stable and has no position bias |
| Scorecard | every kept dimension rated for at least four animations (idle, walk or run, jump, attack) against at least two references | measurement, not a pass/fail on Piñata |
| Licences | every reference's source and licence recorded; none in the repository | |
| Existing outputs | byte-identical | the benchmark adds tooling only |

## Batches

- **A. References and rubric:** the fetch script, the references cut to strips and GIFs, the rubric panel kind in
  the judge runner, the degraded copies, the judge-validation gate. Review.
- **B. Scorecard:** the pairings, the numbers on both sides, the panels, the scorecard in this plan's results, and
  the next plans named from the weakest dimensions. Review.

## Results

### Batch A: references and rubric

The first judge-validation run below is superseded: its degraded copies changed more than their dimension (canvas
sizes, frame counts and the rate differed from the reference, and the controls were measured on pooled means, which
hide a position bias). The run on the corrected copies follows the first one.

Obtained by script from itch.io (a free download needs a page token and a POST per file; no browser flow was
needed), all recorded with page, licence and SHA-256 in `manifest.json` of the folder given to
`npm run benchmark-fetch`:

| Reference | Licence | Used |
|---|---|---|
| Fantasy Warrior (LuizMelo) | CC0, named on the page and in its `License.txt` | idle 10, run 8, jump 3, attack 7 frames |
| Huntress 2 (LuizMelo) | CC0, same | idle 10, run 8, jump 2, attack 6 |
| Evil Wizard (LuizMelo) | CC0, same | idle 8, move 8, attack 8 (no jump) |
| 8 Directional 2DHD Character (hormelz) | CC0, named on the page | fetched (RAR, one sheet per direction) and not cut: 256-pixel painted frames, not pixel art at Piñata's scale |
| LPC layers (generator) | CC-BY-SA 3.0 / GPL 3.0 | the calibration control's layer sheets, walk, back view; two dressings, cape layers separate |

Piñata's side: `pinata export` of the knight and the wizard, right-facing idle, walk, run, jump and attack, cut by
the Aseprite tags and resampled from 24 to 12 frames a second. The references have no frame durations, so they play
at the stated default of 12 frames a second. Strips (four frames to a row), per-frame PNGs and GIFs are written by
`npm run benchmark -- build`; each clip is the first 16 frames at most, so Piñata's long idle, walk and jump
clips show only their first 1.3 seconds (batch B chooses the windows).

First judge-validation run, superseded (`npm run judge -- run` of the rubric panel: 11 pairs and 2 controls, 26 images,
three judges):

| Dimension (degradation, pairs) | Reference above its degraded copy | Gate 80% | By judge (opus / sonnet / haiku) |
|---|---|---|---|
| Fluidity (every second frame dropped, 3) | 12 of 18 answers, 67% | missed | 6/6, 6/6, 0/6 |
| Secondary motion (LPC cape frozen, 2) | 4 of 12, 33% | missed | 4/4, 0/4, 0/4 |
| Environment (feet slid a pixel a frame, 3) | 5 of 18, 28% | missed | 5/6, 0/6, 0/6 |
| Anticipation (wind-up and holds removed, 3) | 8 of 18, 44% | missed | 4/6, 2/6, 2/6 |
| Weight, readability, appeal | no degraded copy defined | not tested | |

Controls (a reference against itself, two): mean rating difference 0.00 (gate 0.5), every answer tied, "cant_tell" for
which to ship in all 12 answers.

Kept and dropped: by the gate as fixed, all four tested dimensions are dropped from the pooled panel, and weight,
readability and appeal are untested. The split by judge says where the signal is: opus sees the fluidity, secondary
motion and environment degradations (100%, 100%, 83%), sonnet sees fluidity, haiku nothing. Opus alone misses the
gate only on anticipation (67%). The gate counts every answer, so no dimension passes. Reading the ratings, judges also
mark the degraded copy down on dimensions it does not touch (a dropped-frames run is also lower on anticipation and
secondary motion), so the rubric has a halo effect.

Cost: a first run failed (haiku wrapped its answer in a `ratings` key, so the questions text gives an example per
image) at $0.774; the counted run opus $0.496, sonnet $0.223, haiku $0.018: $0.74. Total $1.51.

Judge validation on the corrected degraded copies (the same panel, 11 pairs and 2 controls, 26 images, three judges;
the gate's thresholds unchanged; `npm run benchmark -- gate`):

| Dimension (degradation, pairs) | Reference above its degraded copy | Gate 80% | By judge (opus / sonnet / haiku) |
|---|---|---|---|
| Fluidity (every second frame held for two steps, 3) | 12 of 18 answers, 67% | missed | 6/6, 6/6, 0/6 |
| Secondary motion (LPC cape frozen, 2) | 4 of 12, 33% | missed | 4/4, 0/4, 0/4 |
| Environment (feet region slid back and forth, 3) | 6 of 18, 33% | missed | 6/6, 0/6, 0/6 |
| Anticipation (wind-up frames removed, strike held, 3) | 9 of 18, 50% | missed | 6/6, 3/6, 0/6 |
| Weight, readability, appeal | no degraded copy defined | not tested | |

Controls (a reference against itself, two): the top-bottom rating difference per answer and dimension averages 0.00
over 12 of 12 answers (gate 0.5): stable, and no position bias in the judges' ratings; "cant_tell" for which to ship in
all 12 answers.

Kept and dropped: by the gate as fixed, all four tested dimensions are dropped from the pooled panel, and weight,
readability and appeal are untested; `benchmark gate` exits 1. This result replaces the first one. The split by judge
is cleaner than before: opus rates the reference above the degraded copy in every answer for all four dimensions, so
it sees each corrected degradation; sonnet sees only fluidity (and half of the anticipation answers); haiku sees none.
The gate counts every answer, so a pooled panel of the three does not pass any dimension. Whether to keep opus as the
only judge for the benchmark, or to fix the threshold per judge, is a decision for batch B and would be a change to
the gate, not a reading of this result.

Cost: opus $0.511, sonnet $0.220, haiku $0.018: $0.75, one run, every judge answered at the first attempt.

### Human review, first round

A blind review page (eight pairs, the side shuffled, each pair one hand-animated reference and one Piñata animation of
the same move at the same pixel scale; references at 12 frames a second, Piñata at its exported 24) was rated by the
project owner, who has played many games and is not an animator. Question: which would you ship; optional flaws of
the one not picked.

| Pair | Picked | Said about the other |
|---|---|---|
| Idle, warrior against knight | reference | Piñata: looks procedural, pose unclear, "doesn't look like a defined character" |
| Run, warrior against knight | reference | Piñata: "leans backward weirdly when running" |
| Attack, warrior against knight | **Piñata** | reference: too fast |
| Idle, evil wizard against wizard | reference | Piñata: stiff, pose unclear |
| Walk, evil wizard against wizard | **Piñata** | reference: pose unclear |
| Attack, evil wizard against wizard | reference | Piñata: "doesn't do wizardy stuff" |
| Run, huntress against wizard | reference | Piñata: "looks like he's got a limp" |
| Jump, warrior against knight | **Piñata** | reference: stiff, pose unclear (its jump has three rising frames only) |

Piñata picked in 3 of 8. What the answers point at, each a defect the tool can fix for any character:

- **Runs lean backward.** A run leans forward; the knight's run leans back. A motion defect (the run take, its
  retarget or the root's pitch), not art.
- **A limp.** The wizard's run reads as a limp: the stride is uneven between the legs.
- **Idles are lifeless and procedural.** No breathing, weight shift or held pose with intent; at this scale the
  character's silhouette does not read as a defined character.
- **One attack for everyone.** A wizard punching reads wrong; attacks need to suit the character (cast, swing,
  thrust), a choice in the behaviour library.
- Wins: the knight's attack and jump and the wizard's walk were preferred, the attack against a reference judged too
  fast, the jump against a reference with three frames.
