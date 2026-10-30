# P3 Findings

Gate thresholds are locked (see `pocs/p3-secondary-motion/gates.ts`). Material values are tuned within them.

## Run 1 (starting materials from the plan)

- Gates: all pass except settle. settleSeconds silk 2.73, wool 5.35, leather 5.18 (max 3.0); order wrong (silk
  fastest). overshoot silk 8.9, wool 9.0 degrees; lag 11-13 frames; windAlignment 0.99; maxStrain 0.059;
  penetratingFrames 0; maxSpeed 3.2-3.9 m/s; deterministic.
- Cause: settle time follows roughly 1 / (damping + drag / mass); wool and leather had the same 1.25/s.

## Run 2

- Change: internal damping wool 0.5 -> 2.4, leather 1.0 -> 5.0 (drag unchanged, so light silk still catches the
  air most).
- Gates: all pass. settle silk 2.73 s, wool 1.98 s, leather 1.23 s; overshoot silk 8.9, wool 8.6 degrees.
- Observed: the world-space side onion skins smear the walking body into a grey band and make the simulated and
  rigid capes look alike, so they are not usable for the judge panel. The angle chart reads well (trailing while
  walking, swing after the stop, settle). Added body-frame onion skins for the judges.

## Run 3 (stills and wind scenario)

- Change: wind direction [1, 0, 0] -> [0, 0, -1]. Blowing along +X hit the cape edge-on: windAlignment was 0.99 but
  the hem barely moved, because the gate checks direction, not magnitude. Wind from the front now streams the cape
  backward. Added `windDisplacementMetres` (mean horizontal hem drift) to metrics.json as information, not a gate.
  Added body-frame stills (side, plus front for wind).
- Gates: all pass; windAlignment 0.995. Wind drift silk 0.52 m, wool 0.25 m, leather 0.08 m.
- Observed: body-frame stills separate the materials clearly (silk fans widest, leather a narrow wedge) and the
  rigid control collapses to one line.
