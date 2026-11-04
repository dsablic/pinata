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
  Angles are no longer kept for the page. The skin command keeps its painters.
- Changed while building, relaxing "one snap": the strip is laid at the bone's projected length kept with a pixel of
  hysteresis, not at the length between its snapped ends, which made short parts jump by a third of their length as
  diagonals crossed pixels; it is held to at most 1.25 of the sprite's drawn length as well as at least 0.6; and in
  batch C rigid parts got back their 22.5-degree steps with hysteresis (below). What stays one snap: every part
  starts at its snapped first joint, and cloth parts follow their snapped curve points. A rigid part's end is not
  where its child starts, by up to about 2 px on a 10 px bone.

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
| Skins fit their bones | `npm run skin -- fit` flags no part view of any skin; the survey's pops, fragments and stretch no worse than batch C's for any character, and the knight's pops none | batch D, the sprites redrawn |
| Redrawn sprites | blind panel of each redrawn skin's directions sheet against the current one: rated at least as good (1-5) on average, and the current preferred in at most 50% of non-control answers | judges, both orders, controls |
| Judges | blind panel, walk, turn and fall strips of each character: the new renderer preferred over the current one in at least 65% of non-control answers, and rated at least as clean (1-5) | judges, both orders, controls |

## Batches

- **A. The survey:** detectors, stress scenarios, strips; the current renderer's counts recorded as the baseline.
  Review.
- **B. One painter, one snap, one draw order:** the page renders through them; the survey and cost gates. Review.
- **C. The bar:** the judge panel; then the natural-motion plan resumes at batch C. Review.
- **D. Skins fitted to their bones:** the sprites `npm run skin -- fit` flags are redrawn at the length their bone
  projects from the page camera; the fit and redrawn-sprites gates. Review.

## Results
### A. The survey

`npm run glitches`: 15 minutes per character over the four layouts, stress runs and wind (design.md, Checking the
page world). The detectors and the renderer's layers are tested; the survey's counts become a test once batch B
meets them. Stretch is the gate as fixed, on the length a part is drawn at (after the 0.6 floor, which rounds to
whole pixels). A per-view check (a part outside the same bounds against its usual fit in its view) was added to it
here and then taken out of the gate in batch B, reported on its own as refit: it counts shoulder-to-shoulder parts
foreshortening by a pixel as the body turns, which is geometry, not stretch. That loosens the measure this baseline
used (the gate's wording never had the check); batch B's table measures both renderers both ways.
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

### B. One painter, one snap, one draw order

The survey on both renderers with the same detectors. The current renderer runs on the motion as it was; the new
one after two motion fixes the survey found (below). Stretch is the gate's measure, drawn length against the
sprite; the per-view refit and the joint miss are reported, not gated.

| Character | Renderer | Fragments | Pops | Stretch | Refit | Joint miss ≥ 2 px | Blank | Flicker, worst window | Median |
|---|---|---|---|---|---|---|---|---|---|
| knight | current | 3.65% | 57 | 6.24% | 10.35% | not measured | 1 | 65.20% | 12.15% |
| knight | new | 0.00% | 72 | 0.00% | 6.44% | 4.83% | 0 | 36.90% | 10.51% |
| rogue | current | 0.45% | 139 | 5.23% | 3.56% | not measured | 0 | 46.90% | 10.56% |
| rogue | new | 0.00% | 0 | 0.00% | 11.72% | 2.27% | 0 | 48.18% | 10.38% |
| dwarf | current | 4.22% | 20 | 5.14% | 27.52% | not measured | 0 | 37.17% | 12.52% |
| dwarf | new | 0.00% | 4 | 0.00% | 15.06% | 6.99% | 0 | 32.98% | 11.73% |
| wizard | current | 0.90% | 20 | 2.21% | 4.43% | not measured | 1 | 42.41% | 10.32% |
| wizard | new | 0.00% | 0 | 0.00% | 3.52% | 1.51% | 0 | 32.42% | 11.97% |

- Met: fragments for every character; pops for the rogue and wizard; cost, 5.4 to 6.8 ms of main thread per frame
  at p95 on the demo page in Chrome with four characters (the current renderer measured 7.6 to 8.3 ms).
- Stretch is met by construction: the strip painter holds every part between 0.6 and 1.25 of its sprite, so the
  gate now says only that no sprite is distorted beyond those bounds. Where a bone asks for more or less, the part's
  end misses its joint instead; the joint-miss column counts frames where that is 2 px or more (the plume and capes
  in big swings, shins on landings, feet). The current renderer does not report a part's asked length, so its misses
  (from 22.5-degree angle snapping) are not measured. The judges decide whether the trade shows.
- Missed, and worse than the current renderer: the knight's pops, 72 against 57. They are its left foot as the
  knight turns to face the front or back. That view's sprite is a pixel long where the bone projects four, so the
  foot drawn true to its view has under half its side-on pixels, and it crosses back over half within three frames
  as the stride carries on; stretching it to its bone would break the stretch bounds instead. The skin's front foot
  does not match the mannequin from this camera.
- Missed: the dwarf's four pops, its axe blade turning edge-on and its cloak folding within one to two frames.
- Missed by 1.3 points: the rogue's worst flicker window, a fast turn that shows one view for a single frame, on
  both renderers at the same frame.
- The flicker gate's cloth part (`npm run gates`, bound against rigid per window, the natural-motion plan's): met
  for the knight and rogue (the knight's worst was 15.38% before), missed for the dwarf (2.56%) and wizard (2.60%).
- Found by the survey and fixed in motion, not rendering: a character dropped in elsewhere, or placed again, was drawn
  for one frame with its cloth curves from where it had been (cloth parts popped, and the worst flicker windows came
  from it); and a character walking off an edge was posed on the lower ground for one frame before it fell (blank
  frames, every part popping). `reset` now drops the curves, and the player no longer lowers the body onto a foot
  over a drop.
- The judge gate is batch C's.

### C. The bar

`npm run rendering-panel` builds the pairs: for each character a walk, a turn on the spot and a walk-off fall, chosen
by fixed rules from the survey's runs, drawn by both renderers on the same motion (the cast's `painter: 'rotate'` is
the current renderer); two controls are the current renderer against itself a frame later. Three fresh judges per
round, both orders. The gate needs the new renderer preferred in at least 65% of non-control answers.

| Round | Strips | New picked | Current picked | Can't tell | Ratings, new / current | Controls unseparated | Left picks |
|---|---|---|---|---|---|---|---|
| 1 | 8 frames, scale 3 | 2 of 72 | 2 | 68 | level (3.3-3.7 each) | 100% | 17% |
| 2 | 4 frames, scale 5 | 2 of 72 | 9 | 61 | new a little lower on the dwarf's and wizard's walks | 83% | 33% |
| 3 | 4 frames, scale 5, rigid parts snapped | 8 of 72 | 11 | 53 | level but the dwarf's turn (3.3 / 3.8) | 33% | 70% |

- Missed in every round, both halves: the new renderer was never preferred, and in round 3 it was rated lower on
  the dwarf's turn (3.3 against 3.8) and fall (3.0 against 3.2), with the current renderer picked more often (11
  against 8; 9 against 2 in round 2). Most answers were can't tell. Round 3's controls were separated by two judges of
  three and its picks leaned left (70%), so it says little either way.
- The panel has little power for what the survey measures: a window is sampled to four frames, a frame every few,
  so pops, tears and blank frames lasting one to three frames seldom reach the judges. Round 2 cut the strips from
  eight frames to four after round 1, which made that worse. What the panel does show is the look of ordinary
  motion, where the judges could not tell the renderers apart, and one real fault, found by looking at the strips the
  judges preferred:
- In round 2 the strip painter laid thin rigid parts at any angle, and a hat cone a few degrees off vertical came
  out ragged under nearest sampling, where the current renderer's 22.5-degree steps keep it crisp. Rigid parts on
  the strip now turn in 22.5-degree steps from their snapped joint with the current renderer's hysteresis, at their
  kept length; cloth stays on its curves. Round 3 is that renderer.
- The survey on it: fragments 0% and stretch 0% for every character; pops 17 (knight, against 57), 0, 2 (dwarf,
  against 20), 0, so the pop gate is still missed for two; worst flicker windows 47.14% (65.20%), 47.19% (46.90%,
  missed), 34.52% (37.17%), 30.54% (42.41%); no blank frames. Cost after the change: 4.8 to 6.0 ms at p95 on the
  test and demo pages in Chrome.
- The joint-miss count was redefined in batch C: B's column compared the length asked with the length drawn; C's
  measures the distance from a drawn end to the joint the next part starts at, the only miss that shows. A part's
  end is 2 px or more off it in 55%, 12%, 10% and 84% of frames (knight, rogue, dwarf, wizard): the stepped angle of
  a 10 px thigh or shin leaves its end up to 2 px from the knee. The current renderer steps angles the same way but
  does not report this, so it is not measured for it.
- The new renderer stays on the page, as a judgement on these results rather than a gate met: it removes the tears,
  blank frames and most pops the survey counts, and costs less, and on ordinary motion the judges could not tell it
  from the current one, though they leaned slightly to the current one. The judge gate stays missed. The
  natural-motion plan resumes at its batch C.

### D. Skins fitted to their bones

The sprites `npm run skin -- fit` flagged were redrawn at the length their bone projects from the page camera: the
knight's plume (front, three-quarter front), front feet, back three-quarter feet and sword (back, back three-quarter),
the rogue's scarf wrap and the dwarf's mantle in the three-quarter views. The back view's sword also has a shorter
grip, three columns with the hand in the middle, so the foreshortened sword keeps its proportions.

- Fit: no flags for the rogue, dwarf and wizard; one for the knight, its back three-quarter foot sprites (both span
  3), each of which also draws the other foot in the mirrored sector. The two bones project 1.3-3.7 px and 0.97-3.3 px; span 3 misses
  the second by 0.03 px and span 2 misses the first, so no span fits both. **Missed**, narrowly; fixing it needs a
  skin to hold a sprite for the mirrored sector.
- Survey: fragments and stretch 0% for every character; pops 1 (knight, against 17), 0, 1 (dwarf, against 2), 0.
  **Missed** for the knight (none required) by one pop, a sword hidden at a view change; the dwarf's, an arm at a
  view change, is no worse than batch C's, as its gate asks. Worst flicker windows 50.30%, 47.19%, 34.65%, 30.41%; no
  blank frames. The knight's is worse than batch C's 47.14%: flicker is not gated here, but it is a regression, not
  yet traced to a part.
- Redrawn sprites, blind panel of each redrawn skin's eight-direction sheet against the current one, three judges,
  both orders: every answer can't tell, ratings level (knight 4.0, rogue 3.3, dwarf 4.0); the control unseparated by
  every judge. **Pass.**

