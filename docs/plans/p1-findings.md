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
