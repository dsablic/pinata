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
