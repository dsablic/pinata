# Piñata Findings

This document summarises what the proofs and the plans finished since have established. Each proof's findings, judge
artefacts and raw numbers are linked from its section; this page is the short version.

## The question

Can an AI agent create and animate pixel-art characters, with the tool doing what an AI finds hard by hand: physics,
inverse kinematics and secondary motion, checked by machine-readable diagnostics? And can the visual style be a
separate, swappable layer?

## How it was tested

- **Gates fixed before building.** Every proof wrote its pass/fail thresholds into a plan before any code existed.
  Gates were only ever tightened afterwards, never loosened, and every change was logged with its reason.
- **Controls that must fail.** Where a gate could pass trivially, a control was added that the gates must reject: a
  rigid cape (P3), a sliding "skating" walk (P4), an unsnapped jittering camera (P2). Reviews found several gates that
  a control passed; each was tightened until it did not.
- **Blind AI judge panels** instead of human review: three fresh agents per question, neutral file names, the answer
  key kept outside their folder, every A/B pair shown in both orders, hand-made-vs-hand-made control pairs to measure
  bias, and ground-truth questions wherever possible.
- **Independent code reviews** of each batch, told to assume the code was wrong. They found real bugs at almost every
  step (a speed bug in the motion script, holes in thin parts, gates that measured nothing, hints pointing the wrong
  way) before results were trusted.

## Results by proof

| Proof | Verdict | One-line result |
|---|---|---|
| P1 static style | Fail | The procedural renderer is readable and consistent across 8 directions, but blind judges picked the hand-made reference in 36 of 36 comparisons, before and after a targeted style revision. |
| P2 pixel stability | Pass (one gate failed by definition) | With temporal hysteresis, flicker stays under 1% on a slow turntable; an unsnapped camera flickers 25-34%. |
| P3 secondary motion | Pass | Cloth reads as inertia; judges ranked silk, wool and leather and read the wind correctly every time; a rigid cape fails every motion gate. |
| P4 locomotion | Pass on motion, fail on readability | Planted, non-sliding, IK-solved walking, turning, pivoting and stopping; judges saw grip and turns (12 of 12), but could not tell 48 px procedural walk strips from a sliding control. |
| P5 AI authoring loop | Pass | Fresh agents authored a rogue, a dwarf and a wizard from one-line prompts in 1, 4 and 6 runs, with no format failures; judges matched all three to their prompts. |
| P6 style swap | Pass | One character's motion is byte-identical across three styles; judges grouped six images by character and by style without error. |
| Skins spike | Promising, formally inconclusive | An AI artist's per-part sprites validated first try; judges preferred the skinned walk over the procedural one, and rated it more hand-made than CC0 references in 44 of 54 comparisons, but the control rule failed in every round. |

### P1: procedural style ([findings](plans/done/p1-findings.md))

Rendering a mannequin of capsules and boxes into a G-buffer and stylising it (banded shading, outlines, decals) gives
readable sprites, but not hand-made-looking ones. A second round added hue-shifted ramps, selective outlines, accent
decals and an asymmetric pose; the judges' complaints moved from "uniform outline, no details" to "systematic
shading, assembled parts", and their confidence rose. Facing direction read correctly in 3/4 views but not from a pure
side camera.

### P2: pixel stability ([findings](plans/done/p2-findings.md))

Slow rotation initially flickered just over the 1% limit at 32 px. Temporal hysteresis in the rasterizer (a pixel
changes in or out of the silhouette only past a coverage margin) fixed it without changing single-frame output. The
part-area-jump gate failed because its "motion cause" test missed occlusion (a forearm sweeping over a thigh); it was
recorded as failed rather than redefined after the fact.

### P3: secondary motion ([findings](plans/done/p3-findings.md))

An XPBD solver with per-material compliance, damping and drag, colliding against the body's distance field, gives
cloth that lags, overshoots and settles in material order (silk slowest, leather fastest) and streams in wind. The
first gates passed for a rigid cape too (settle clock during deceleration, no lag floor, wind direction without
magnitude, penetration checked only after collision); after tightening, the rigid control fails every motion gate.

### P4: locomotion ([findings](plans/done/p4-findings.md))

Footsteps planned from distance travelled, landing targets predicted from the root's future position and heading,
two-bone IK and a pelvis drop give planted feet with no measurable slide. Knee-speed peaks came from three
compounding causes found by measurement (an over-wide pelvis smoothing window, a reach limit that let the knee lock
straight, compressed swing edges). The skating control initially also locked its knees, which made the first judge
panel unfair; it was rerun with a fair control and clean images. The result stands: correct motion is not
automatically readable motion at 48 px.

### P5: AI authoring loop ([findings](plans/done/p5-findings.md))

A character is a directory of JSON files; one command (`npm run check`) validates it, runs every static, locomotion
and cloth gate, and prints a hint per failure naming the part, frame and fix. Before the experiment, a review found
the guide and hints pointing the wrong way on the most likely failure (sliding feet are fixed by raising step height,
not lowering it); with that fixed, every author passed. The authors' main complaint was that simulated cloth was not
drawn in the stills; chains and capes with a `render` entry are drawn into the sheet and the walk strip.

### P6: style swap ([findings](plans/done/p6-findings.md))

Motion never reads the style, so swapping styles is free: three styles written by an agent from one-line briefs
render the same two characters with identical motion data, each style passing the static and flicker gates.

### Skins spike ([findings](plans/done/skins-findings.md))

Per-part sprites drawn by an AI artist, placed and rotated on the rig's projected bones, look far more hand-made than
procedural rendering, and walk better. The A/B panel's control rule (judges should answer "can't tell" between two
hand-made sprites) broke down once the candidate was competitive: judges switched from detecting machine art to ranking
quality, including between references. The references were modest CC0 sprites, so this shows competitiveness with
them, not with expert work.

## After the proofs

Results of the plans finished since, each built against gates fixed first. How each piece is built is in
[`docs/design.md`](design.md).

| Work | Result |
|---|---|
| General limbs | Any number of legs with any segment count, arms and spring or oscillator appendages; biped, quadruped, hexapod and octopod templates. A stride over about 0.6 times the hip spacing crosses legs in 3/4 views; short quadruped legs strain the knee-speed gate. |
| Motion data | Humanoids move by retargeted CMU capture with motion matching, feet held on the ground and a light physical body; jumps play capture take-offs and landings. Node and Chrome compute `Math` differently, so results are deterministic per engine. |
| Live runtime (P8) and the page as the world | Characters animate live in the browser, on a rope or walking on a page's own elements, within the frame-cost gate. The page's standing, cloth-flicker and count gates are missed narrowly (see [`TODO.md`](TODO.md)). |
| Natural page motion, unified part rendering | Capes, cloaks and robes are simulated cloth drawn in the skins; one strip painter draws every part; falls dip and absorb. |
| Phase 1, the minimum viable tool | Met: `pinata new, check, skin, render, export` and an MCP server; sprite sheets, Aseprite JSON and `.aseprite` files in eight directions. On the third run of the exit test three of three fresh agents reached a passing export within 10 `check` runs and judges matched all three to their prompts (9 of 9). |
| Automated checks | One `npm run verify` over typecheck, tests, lint, examples, the site, the browser suite and the baselines; gates declared with a failing and a passing case. |
| The visual bar, three attempts | Missed each time against hand-drawn game sprites. A beat-and-pose stage rated 3.06 against 3.48 and read as "made by software" in 46% of answers; hand-drawn walk frames switched cleanly in 81% of switches against a 95% gate (a standing pose resembles no walk frame); a restyled knight was picked in 50% against a two-thirds gate. Judges named limbs rotated or slid rather than redrawn, and no contact, passing or squash poses. |
| Facing readability | Direction checks in `pinata check`, `pinata review` and an eight-direction preview are built. Fresh agents' characters: 60% of idle and 65% of walk answers right against gates of 90% and 80%. A hand-drawn eight-direction control reads at 81% with the same judges (cardinal views 24 of 24, three of the four diagonals 9 of 18), so 90% is not shown to be within reach of hand-drawn art. |
| Animation benchmark, judge validation | A pooled panel of three models rates a reference above its degraded copy in 67% (fluidity), 33% (secondary motion), 33% (environment) and 50% (anticipation) of answers against an 80% gate; the largest model alone does so in every answer. Controls are stable with no position bias. |

### The owner's blind reviews

Eight pairs, each a hand-animated CC0 reference against Piñata's animation of the same move at the same scale, sides
shuffled, rated by the project owner: which would you ship.

| Pair | Round one | Round two | Said about Piñata |
|---|---|---|---|
| Idle, warrior against knight | reference | reference | procedural, pose unclear; then: cloth looks dead, "just doesn't look like a resting pose" |
| Run, warrior against knight | reference | about the same | round one: "leans backward weirdly when running" |
| Attack, warrior against knight | Piñata (a punch) | reference | the swing "looks like an old man supporting himself with a stick" |
| Idle, evil wizard against wizard | reference | reference | stiff; then: "too static, looks like he's picking his nose" |
| Walk, evil wizard against wizard | Piñata | Piñata | "looks more like walking, but the style of the other is better" |
| Attack, evil wizard against wizard | reference | reference | "doesn't do wizardy stuff"; then: "shouldn't look like punching with two hands" |
| Run, huntress against wizard | reference | about the same | round one: "looks like he's got a limp" |
| Jump, warrior against knight | Piñata | about the same | "looks like skipping over a puddle" |

Round one: Piñata picked in 3 of 8. Between the rounds runs were made to lean forward and loop on one stride, speeds
were set from leg length, idles were given breath and a weight shift, and each character its own attack (a capture
take of chopping wood for the swing, a composed cast). Round two: 1 of 8 with 3 ties, against a gate of 5.

- **Fixed:** the backward lean and the limp were not named again; both runs moved from a loss to a tie.
- **Idles:** a breathing layer on a capture take is not enough. The take's hand fidget reads as a gesture, the pose
  does not read as resting, and the cloth hangs still.
- **Attacks and jumps:** capture of everyday actions does not read as a game move. An attack needs anticipation, a
  fast strike, follow-through and a held end; a cast a gesture of its own; a jump height, a crouch before and a
  landing after.
- **Measures kept** in `npm run motion-measure`: torso pitch over a run cycle, stride symmetry, idle motion energy,
  the share of walk frames playing walk takes.

## What was built along the way

- A deterministic, headless TypeScript engine: formats with actionable validation, rasterizer and stylizer, XPBD
  cloth, gait planner and IK, diagnostics, PNG and APNG output.
- The `check` command and authoring guide that P5's agents used, plus example characters (knight, rogue, dwarf,
  wizard, piñata, dog).
- Four-legged support, cloth drawn into the pixel output, a 6-14x faster renderer with identical output, and a
  provisional logo (a unicorn piñata hanging from a rope, hit and swinging, in a seamless loop), all made with the
  engine.

## Cross-cutting lessons

- **Gates need controls.** Several gates looked meaningful and passed for the wrong reason (a rigid cape, a sliding
  walk, a foot hovering just above the contact threshold, a speed check comparing the root with itself). A gate is
  trusted only once a control that should fail it does.
- **Reviews before trusting results.** Independent reviews told to assume the code is wrong found a critical problem
  in most batches. The cost was small compared with tuning against a broken measurement.
- **AI judges are reliable for ground truth, less so for taste.** Material ranking, wind direction, prompt matching,
  grip and turn direction were answered correctly and consistently. Facing from a pure side camera was noisy, and
  quality comparisons need strong references and a rating question, because a detection question breaks down when
  the candidate is good.
- **Packet hygiene matters.** An image-assembly bug cut a band through some judge images; it was symmetric (no bias)
  but hurt legibility, and the affected question was rerun.
- **Correct is not the same as readable.** Physically correct walking looked like a shuffle in small strips; readability
  needs animation craft (exaggerated poses, holds) on top of physics.
- **Proportions matter for many-legged bodies.** A stride longer than about 0.6 times the front-to-back hip spacing
  makes legs cross in 3/4 views; short quadruped legs struggle with the knee-speed gate.
- **Performance was an allocation problem, not a language problem.** Removing short-lived vector arrays from the ray
  loop and culling parts per pixel made rendering 6-14x faster with byte-identical output.

## Conclusion

The motion engine works: scripted locomotion, IK and physics-driven secondary motion, authored by AI through text
formats and a single check command with actionable hints, with style independent of motion. The procedural visual
layer does not pass as hand-made; per-part sprites drawn by an AI artist are the most promising replacement. They beat
modest references, but later attempts to close the gap to hand-drawn game sprites (a beat-and-pose stage, hand-drawn
walk frames, a restyle of the knight) missed their judge gates, so existing, human-drawn art is the way past that
bar. Against hand-animated sprites the locomotion holds up and the idles, attacks and jumps do not: game feel is the
open problem. The next steps are in [`docs/ROADMAP.md`](ROADMAP.md).

## Open questions

- Can AI-drawn skins hold up at several sizes (the P7 size gate needs per-size skins) and pass a human pixel artist's
  review?
- Can composable behaviours be authored by agents as reliably as characters were in P5?
- How well do the gait planner and gates hold up for short-legged and many-legged bodies (general limbs work)?
