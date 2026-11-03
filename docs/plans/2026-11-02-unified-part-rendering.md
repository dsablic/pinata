# Unified Part Rendering on the Page

**Goal:** every part of a skinned character is drawn by one rule from one stable set of pixel positions, so new motion
(cloth, falls, turns, jumps) does not keep exposing glitches; and glitches are found by a standing check, not by eye.

Today each part is placed on its own every frame: its angle snapped to 22.5 degrees, its length refitted, its anchor
rounded to a pixel, its view chosen, its draw order sorted by depth; cloth-bound parts take a second path, warped
along a curve. Each decision crosses its boundary at its own moment, and each fix so far guarded one of them.

## Design

- **A glitch survey** (`npm run glitches`, Node): every skinned character on the recorded layouts and seeds, plus
  scenarios made to stress the renderer (drops from high and low elements, turns on the spot, fast walks, wind),
  rendered frame by frame with each pixel's owning part. It counts, per character:
  - fragments: pixels of a part not connected to the part's largest piece;
  - pops: a part's pixel count falling by more than half and returning within three frames while no nearer part
    covers it;
  - stretch: a part drawn longer than 1.25 or shorter than 0.6 of its sprite's drawn length;
  - flicker: P2's measure.
  It writes the worst frames of each kind as strips for review, and the counts are a test.
- **One painter:** every two-joint part is a strip along a curve: a rigid part's curve is its bone, a cloth-bound
  part's is its cloth curve. The page draws every part with it; the skin command keeps its painters, so its sheets
  stay as they are.
- **One snap:** all joints and curve points of a character are projected and snapped to pixels once per frame, with
  hysteresis per point, before any part is placed; parts read only snapped points. Lengths and angles are not snapped
  separately.
- **One draw order rule:** as the natural-motion plan's batch E fixes it (a part above its parent by rule, order
  between independent parts switched with hysteresis); built here, since the painter needs it.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical, except the page's sprites | |
| Survey runs | every skinned character, at least 10 minutes of frames each, including at least 20 drops and 20 turns on the spot | counted by the survey |
| Fragments | in at most 0.1% of frames per character | |
| Pops | none | |
| Stretch | in at most 0.1% of frames per character | |
| Flicker | each character's worst window no worse than with the current renderer, and bound cloth adds at most 1% over rigid in each window | the skins-show-cloth gate's flicker part |
| Cost | at most 8 ms of main thread per frame at p95 in Chrome, four characters | |
| Judges | blind panel, walk, turn and fall strips of each character: the new renderer preferred over the current one in at least 65% of non-control answers, and rated at least as clean (1-5) | judges, both orders, controls |

## Batches

- **A. The survey:** detectors, stress scenarios, strips; the current renderer's counts recorded as the baseline.
  Review.
- **B. One painter, one snap, one draw order:** the page renders through them; the survey and cost gates. Review.
- **C. The bar:** the judge panel; then the natural-motion plan resumes at batch C. Review.

## Results
### A. The survey

`npm run glitches`: 15 minutes per character over the four layouts, stress runs and wind (design.md, Checking the
page world). The detectors and the renderer's layers are tested; the survey's counts become a test once batch B
meets them. Stretch is the gate as fixed, plus a part outside the same bounds against its usual fit in its view.
Blank frames are counted on their own, so batch B can be held to fewer of them as well as to the flicker gate. The
flicker gate's cloth part (bound against rigid, per window) stays with `npm run gates`.

Baseline, the current renderer:

| Character | Drops | Turns | Fragments (frames) | Pops | Stretch (frames) | Blank | Flicker, worst window | Median |
|---|---|---|---|---|---|---|---|---|
| knight | 24 | 157 | 3.65% | 57 | 12.83% | 1 | 65.20% | 12.15% |
| rogue | 38 | 93 | 0.45% | 139 | 92.71% | 0 | 46.90% | 10.56% |
| dwarf | 35 | 99 | 4.22% | 20 | 86.40% | 0 | 37.17% | 12.52% |
| wizard | 25 | 97 | 0.90% | 20 | 7.91% | 1 | 42.41% | 10.32% |

What the worst frames show:

- Cloth-bound parts tear: the knight's cape and the dwarf's cloak break into strips, streaks and speckled slabs when
  their curves fold or swing far (most fragments and the worst flicker).
- The wizard's robe and the dwarf's cloak vanish for a frame or two; the rogue's scarf tail drops out about every 45
  frames of a walk.
- Some sprites are drawn larger than their bones: the rogue's left foot and scarf wrap, the dwarf's left thigh and
  mantle fit below 0.6 of their drawn length in most frames, so the floor holds them and they overrun their joints
  (most of the rogue's and dwarf's stretch).
- Feet fold to nothing when they point at the camera; the knight's plume and the shins stretch on landings.
- Single frames come out blank or cut off at the sprite box's edge.
