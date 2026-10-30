# P1 Findings

Gate thresholds are locked (see `pocs/p1-static-style/gates.ts`). Each run changes one thing.

## Run 1 (baseline, plan assets)

- Change: none; plan assets after the harness review fixes.
- Gates: outlineGaps 0, maxThinFraction 0.765 (FAIL), paletteSize 15, maxStrayPixels 1, nondeterministic 0
- Observed: side views (d2, d6) at 32px show the cape as a detached 1px red line (0.06 m thick is about 1px).
  Hands, feet and upper arms are 5-6px blobs with thin fractions 0.33-0.40. Helmet reads as a bald sphere; the
  visor slit is the only head detail and vanishes from the side. The cape back is one flat shade (a box face has
  one normal). The sword reads as a light line inside its own outline.

## Run 2

- Change: cape thickness 0.06 -> 0.11 (rounding 0.04); hands r 0.085 -> 0.1; feet r 0.075/0.065 -> 0.09/0.08;
  upper arms r 0.095/0.085 -> 0.105/0.095. Rule of thumb: at 32px a part needs about 0.11 m (2px) across to read.
- Gates: outlineGaps 0, maxThinFraction 0.250 (at the limit), paletteSize 15, maxStrayPixels 1, nondeterministic 0.
  All automated gates pass.
- Observed: side-view cape is now a 2px strip attached to the back. Limbs read as limbs at 32px. Remaining visual
  issues: helmet silhouette is generic, cape back is flat, sword overlapping a leg reads as a ladder at 32px.

## Run 3

- Change: added a `plume` capsule (cloth-red, r 0.07 -> 0.05) sweeping from the helmet top to the back.
- Gates: all pass, unchanged (maxThinFraction 0.250, paletteSize 15, maxStrayPixels 1).
- Observed: the silhouette now reads as a knight at 32px, and the backward sweep makes facing easier to read in the
  3/4 and side views. No new colours. Remaining: cape back is one flat rectangle.

## Run 4

- Change: split the cape into two panels (`capeL`, `capeR`, width 0.3 each) with width axes angled +/-0.3 in z, so
  the light hits them differently.
- Gates: all pass, unchanged (maxThinFraction 0.250, paletteSize 15, maxStrayPixels 1).
- Observed: the back view shows a lit and a shadowed panel, which reads as a centre fold; side views show a slight
  flare. A few inner-line streaks on the back panels at 48px 3/4 back-left.

## Stopping after run 4

All automated gates pass and the remaining issues are minor:

- maxThinFraction sits exactly at 0.25, from `hips` in `32px-el30-d2`: 4 visible pixels, one of them thin because
  the sword sits behind it. A 4-pixel part can only score 0, 0.25, 0.5 and so on, so this is one pixel from failing,
  and a 3-pixel hips would drop out of the gate entirely. Watch it when the knight changes.
- Run 2 changed four parts at once despite the one-change rule. They share one cause (too thin for 32px), but the
  log can't attribute the gain to a single part.
- At 32px, where the sword crosses a leg in the side view, it reads as a ladder (blade fill plus outline).
- Faces carry no detail beyond the 3px visor, which is hidden from the side. Expected for procedural rendering;
  decals at more anchors would be the next lever.

Next: reference sprites (Task 14), then the human and external review (Task 15).

## Review (AI judge panel, replaces Task 15's human review)

Method: 3 blind judges (fresh agents, no project context) saw neutrally named, 8x upscaled images only. Facing: 16
frames (32px, elevations 0 and 30, 8 directions). A/B: 3 real pairs (ours vs a hand-made reference) and 2 control
pairs (hand-made vs hand-made), each in both left/right orders. Packet builder, key, raw answers and scoring are in
`docs/plans/p1-judge/` (`score.txt` has the full table).

- A/B: the hand-made reference was picked on all 18 real comparisons; controls were "can't tell" on all 12. The
  judges are calibrated, so this is a reliable detection. Reasons given, consistently: one uniform black outline,
  mechanical banded shading, no accent colours or hand-placed details, stiff symmetric pose.
- Facing: 3/4 view (el30) majority-correct on 7 of 8 directions (passes the 7/8 bar). Side camera (el0)
  majority-correct on 2 of 8 (fails), mostly front/back vs side confusions. Judges varied (14, 10 and 3 of 16
  exact), so part of this is judge noise.
- Parts: head, torso, legs and cape named in all 16 frames by all judges; arms and sword missed only where hidden.

Verdict: P1 fails the "looks hand-made" criterion at both 32px and 48px. Per the design, the fallback is per-part
skins before declaring the procedural style approach dead. The judges' reasons point to specific renderer
improvements (selective coloured outlines, hue-shifted ramps, accent decals) that have not been tried yet.

## P1b plan (decided 2026-10-30, before any change)

Goal: address the judges' cues in the procedural style without hand-drawing, then re-run the same panel.

Changes, each logged as its own run:
1. Selective outlines: an outline pixel takes the darkest shade of the part it borders instead of one global colour.
2. Hue-shifted ramps: shadows shift toward cool/purple, highlights toward warm/yellow (style only, no new colours).
3. Accent decals: belt buckle, chest emblem, visor slits visible from the side, with one accent colour.
4. Pose: weight shift and asymmetric arms instead of a symmetric stance.

The automated P1 gates and thresholds stay as they are, including paletteSize <= 16.

Pass rule, fixed now. Same packet design, same 3 references, 3 fresh judges, every pair in both orders:
- A/B passes if the reference is picked in at most 9 of the 18 real comparisons. 10-14 counts as improved but
  failing; 15 or more is unchanged.
- The panel is valid only if controls stay "can't tell" in at least 10 of 12; otherwise re-run with new judges.
- Facing: at least 7 of 8 directions majority-correct at el30. el0 is reported but does not gate (judge noise was
  high there).
If A/B still fails, move to the skins fallback.

## Run 5 (P1b)

- Change: hue-shifted ramps (shadows toward cool purple, highlights toward warm yellow, deeper shadow shades).
- Gates: all pass (maxThinFraction 0.250, paletteSize 15, maxStrayPixels 1).
- Observed: warmer palette with clearer light/shadow contrast; the cape's lit panel now reads orange against
  wine-red shadow.

## Run 6 (P1b)

- Change: `outlineMode: selective` (outline takes the bordering part's darkest shade); visor decal uses the
  steel-dark shadow instead of the old outline black.
- Gates: all pass (maxThinFraction 0.250, paletteSize 14, maxStrayPixels 2 at the limit).
- Observed: softer, coloured edges instead of a uniform black cut-out line. The sword's outline is now its own
  blue-grey shadow, so it is a little less prominent.

## Run 7 (P1b)

- Change: accent decals: gold belt buckle, red chest cross, visor slits on both sides of the helmet; one new
  colour (gold).
- Gates: all pass (maxThinFraction 0.250, paletteSize 15, maxStrayPixels 2).
- Observed: the cross and buckle read clearly in front and 3/4 views and separate front from back. The side
  visor slits barely register at 32px.

## Run 8 (P1b)

- Change: pose: weight on the left leg, right leg stepped slightly forward, free arm bent forward; hips widened
  0.44 -> 0.48 (thickness 0.28 -> 0.3) after the new pose exposed a 7-pixel hips sliver at 48px back-left.
  Renderer fix: stray cleanup now runs again after decals (decal pixels frozen), because decals were leaving
  single pixels isolated next to the visor, chest cross and buckle.
- Gates: all pass (maxThinFraction 0.250, paletteSize 15, maxStrayPixels 2).
- Observed: the silhouette is no longer symmetric; the forward arm and stepped leg read as a stance rather than a
  T-pose. Ready for the P1b judge panel.

## P1b review (AI judge panel)

Same packet builder, same references, 3 fresh judges. Artefacts in `docs/plans/p1-judge/p1b/`.

- A/B: reference picked in 18 of 18 real comparisons; controls "can't tell" 12 of 12 (panel valid). By the rule
  fixed before the changes, this is "unchanged": the procedural style is still reliably detected. Judges now cite
  "soft, gradient-like / systematic banded shading", "blocky or standardized construction" and "stiff" pose; the
  outline and missing accent details were no longer the main complaints, and judges rated their confidence higher
  (mostly 4), not lower.
- Facing: majority-correct on 5 of 16 frames (el30: 2 of 8). Judges scored 15, 5 and 5 of 16; judges 2 and 3 gave
  near-identical wrong answers (15 of 16 identical), which suggests a shared systematic misreading rather than
  independent evidence. Facing judgements from this panel are too noisy to gate on.

Verdict: P1b fails the "looks hand-made" criterion. Per the pre-registered rule, next is the skins fallback.

Lessons for later judge panels:
- A/B detection is stable and well calibrated (controls never drifted across 6 judges).
- Facing identification is not: prefer a geometric check (for example, facing from the projected positions of the
  visor and cape anchors) and use judges only as a secondary signal.
