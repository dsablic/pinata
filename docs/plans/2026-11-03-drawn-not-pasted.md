# Drawn, Not Pasted

The game-like panel's strongest judge picks every page strip as software and rates it 2-3 against hand-drawn
references' 4 ([natural-motion plan](2026-11-02-natural-page-motion.md), batch E results). Its account: parts stay
rigid and look pasted on, legs turn as solid pieces instead of bending through their poses, the outline and lean stay
the same frame to frame, and the body does not bob on the beat. The glitch work did not touch any of these. This plan
goes after the cut-out look itself, cheapest first, and measures each step on the game-like panel.

## Design

- **A. Beat and pose, no new art.** What hand-drawn walks do that a captured walk at sprite size does not show:
  - a body bob locked to the steps (lowest at contact, highest at passing), at least a pixel at page scale;
  - key-pose timing: the contact and passing poses held a frame or two longer, the in-betweens shortened, as sprite
    animators time a walk; the feet stay planted (timing changes what is shown when, not where feet are);
  - a lean that changes with the step, not one fixed tilt.
  These go in the page's sprite pose, after the walker, as one generic stage for every humanoid.
- **B. Bending parts.** A limb drawn as two rigid sticks reads as solid pieces. Skins may give a two-part limb
  (thigh and shin, upper arm and forearm) sprites keyed by the bend at its middle joint: straight, half and full, per
  view, picked with hysteresis; the torso likewise by lean. The renderer chooses the variant; the art is drawn for
  each of the four humanoids, legs first.
- **C. Cloth that changes shape.** Capes, cloaks and the robe already follow their simulated curve; their silhouette
  should change with it. The strip painter bends the sprite along the curve today; where the judge still sees one
  stiff shape, the sprite gets a second, swung variant keyed by the curve's bend.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical, except the page's sprites and outputs named as meant to change | |
| Feet held | the standing gates no worse than before on every recorded layout, and no planted foot moves while held | A changes timing only |
| Bob | over a minute of walking on the demo layouts, the drawn pelvis row rises and falls with the steps: at least 1 px peak to peak in at least 80% of strides at page scale | measured on drawn frames |
| Survey | fragments, pops and stretch no worse than unified-rendering batch D's for any character | |
| Cost | at most 8 ms of main thread per frame at p95 in Chrome, four characters | |
| Game-like | the natural-motion plan's game-like gate (mean rating at least the references', "made by software" at most 60%), and the largest-model judge rating the page strips at least 3.5 on average | the strongest judge is the one that detects |
| Each step earns its place | after A and after B, a game-like round; a step stays only if the page strips' mean rating does not fall | a new seed and new judges each round |

## Batches

- **A. Beat and pose:** the stage, its gates, a game-like round. Review.
- **B. Bending parts:** the skin format's keyed variants, the renderer's pick, the knight's legs first and a round on
  the knight alone, then the other three. Review.
- **C. Cloth shapes:** only if the round after B still names stiff cloth. Review.

## Results
