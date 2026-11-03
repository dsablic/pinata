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

### How batch B builds it

- `src/style/strip.ts`, `paintStrip`: a sprite along a polyline of pixel points. Its columns before pivot A and after
  pivot B are caps drawn at their own size along the first and last segments; the columns between are spread over
  the polyline's length, held to at least 0.6 of their drawn length (rounded) by running on past the last point.
  Rows lie across, along each segment's normal; at an inner point the normal is the bisector, so neighbouring
  segments share an edge and a bend cannot tear. Each destination pixel is mapped back into the segment it falls in;
  where segments overlap inside a bend the later one wins, so a fold is solid. Two points at a quarter turn reproduce
  the sprite turned exactly.
- `src/style/order.ts`, `drawOrder`: layer first, then farther before nearer, but two parts keep the order they had
  in the last frame (or, the first time, the mannequin's) unless their depths differ by more than 3 cm. A part listed
  after another in the mannequin (helmet after head, face after hood) so draws above it when they are level: the
  structural rule comes from authoring order.
- `skins.ts` with `painter: 'strip'` (the page): every joint and curve point projected and snapped once, with the
  anchors' quarter-pixel hysteresis; two-joint parts painted by `paintStrip` through their snapped points (a rigid
  part's are its two joints), single-joint parts unrotated at their snapped joint; the order kept per character.
  Angles and lengths are no longer kept for the page. The skin command keeps its painters.

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
meets them. Stretch is the gate as fixed, on the length a part is drawn at (after the 0.6 floor, which rounds to
whole pixels), plus a part outside the same bounds against its usual fit in its view.
Blank frames are counted on their own, so batch B can be held to fewer of them as well as to the flicker gate. The
flicker gate's cloth part (bound against rigid, per window) stays with `npm run gates`.

Baseline, the current renderer:

| Character | Drops | Turns | Fragments (frames) | Pops | Stretch (frames) | Blank | Flicker, worst window | Median |
|---|---|---|---|---|---|---|---|---|
| knight | 24 | 157 | 3.65% | 57 | 12.22% | 1 | 65.20% | 12.15% |
| rogue | 38 | 93 | 0.45% | 139 | 7.59% | 0 | 46.90% | 10.56% |
| dwarf | 35 | 99 | 4.22% | 20 | 29.81% | 0 | 37.17% | 12.52% |
| wizard | 25 | 97 | 0.90% | 20 | 5.02% | 1 | 42.41% | 10.32% |

What the worst frames show:

- Cloth-bound parts tear: the knight's cape and the dwarf's cloak break into strips, streaks and speckled slabs when
  their curves fold or swing far (most fragments and the worst flicker).
- The wizard's robe and the dwarf's cloak vanish for a frame or two; the rogue's scarf tail drops out about every 45
  frames of a walk.
- Some sprites are drawn larger than their bones: the rogue's left foot and scarf wrap and the dwarf's left thigh and
  mantle are asked for less than 0.6 of their drawn length in most frames, so the floor holds them and they overrun
  their joints. The stretch gate measures the drawn length, so this shows only as overrun, for the judges.
- The dwarf's mantle (shoulder to shoulder) is far from its usual fit whenever the dwarf turns (most of its stretch).
- Feet fold to nothing when they point at the camera; the knight's plume and the shins stretch on landings.
- Single frames come out blank or cut off at the sprite box's edge.
