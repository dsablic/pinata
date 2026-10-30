# Piñata Findings

This document summarises everything the proof-of-concept phase established. Each proof's plan, tuning log, judge
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

### P1: procedural style ([findings](plans/p1-findings.md))

Rendering a mannequin of capsules and boxes into a G-buffer and stylising it (banded shading, outlines, decals) gives
readable sprites, but not hand-made-looking ones. A second round added hue-shifted ramps, selective outlines, accent
decals and an asymmetric pose; the judges' complaints moved from "uniform outline, no details" to "systematic
shading, assembled parts", and their confidence rose. Facing direction read correctly in 3/4 views but not from a pure
side camera.

### P2: pixel stability ([findings](plans/p2-findings.md))

Slow rotation initially flickered just over the 1% limit at 32 px. Temporal hysteresis in the rasterizer (a pixel
changes in or out of the silhouette only past a coverage margin) fixed it without changing single-frame output. The
part-area-jump gate failed because its "motion cause" test missed occlusion (a forearm sweeping over a thigh); it was
recorded as failed rather than redefined after the fact.

### P3: secondary motion ([findings](plans/p3-findings.md))

An XPBD solver with per-material compliance, damping and drag, colliding against the body's distance field, gives
cloth that lags, overshoots and settles in material order (silk slowest, leather fastest) and streams in wind. The
first gates passed for a rigid cape too (settle clock during deceleration, no lag floor, wind direction without
magnitude, penetration checked only after collision); after tightening, the rigid control fails every motion gate.

### P4: locomotion ([findings](plans/p4-findings.md))

Footsteps planned from distance travelled, landing targets predicted from the root's future position and heading,
two-bone IK and a pelvis drop give planted feet with no measurable slide. Knee-speed peaks came from three
compounding causes found by measurement (an over-wide pelvis smoothing window, a reach limit that let the knee lock
straight, compressed swing edges). The skating control initially also locked its knees, which made the first judge
panel unfair; it was rerun with a fair control and clean images. The result stands: correct motion is not
automatically readable motion at 48 px.

### P5: AI authoring loop ([findings](plans/p5-findings.md))

A character is a directory of JSON files; one command (`npm run check`) validates it, runs every static, locomotion
and cloth gate, and prints a hint per failure naming the part, frame and fix. Before the experiment, a review found
the guide and hints pointing the wrong way on the most likely failure (sliding feet are fixed by raising step height,
not lowering it); with that fixed, every author passed. The authors' main complaint, that simulated cloth was not
drawn in the stills, has since been fixed.

### P6: style swap ([findings](plans/p6-findings.md))

Motion never reads the style, so swapping styles is free: three styles written by an agent from one-line briefs
render the same two characters with identical motion data, each style passing the static and flicker gates.

### Skins spike ([findings](plans/skins-findings.md))

Per-part sprites drawn by an AI artist, placed and rotated on the rig's projected bones, look far more hand-made than
procedural rendering, and walk better. The A/B panel's control rule (judges should answer "can't tell" between two
hand-made sprites) broke down once the candidate was competitive: judges switched from detecting machine art to ranking
quality, including between references. The references were modest CC0 sprites, so this shows competitiveness with
them, not with expert work.

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
layer does not pass as hand-made; per-part sprites drawn by an AI artist are the most promising replacement, and
whether they reach a game-art bar is the main open question. The next steps are in [`docs/ROADMAP.md`](ROADMAP.md).

## Open questions

- Can AI-drawn skins reach game-quality art across 8 directions and several sizes (P7)?
- Can characters run live in a browser within a real-time frame budget, reacting to events (P8)?
- Can composable behaviours be authored by agents as reliably as characters were in P5?
- How well do the gait planner and gates hold up for short-legged and many-legged bodies (general limbs work)?
