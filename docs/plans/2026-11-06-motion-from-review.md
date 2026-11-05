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
| Idles breathe | every idle loop moves the chest by 0.3% to 1.5% of body height per breath cycle, with a weight shift between the feet; a still control (the layer off) fails | amplitudes from body height, so any character |
| Attacks suit | each example plays the attack its `character.json` or its default names; the wizard casts | |
| Human review | a second blind review round of the same eight moves: Piñata picked in at least 5 of 8, and none of the four named defects named again | the owner's eye, as the first round |
| Every other gate | every export gate and `npm run verify` pass | |
| Existing outputs | change only where these fixes are meant, accepted and named | |

## Batches

- **A. Measure:** the four numbers on every example and take; the causes. Review.
- **B. Fix:** lean and limp where they lie, the idle layer, attacks per character; the gates. Review.
- **C. Review round two:** the blind page again, the owner's verdict. Review.
