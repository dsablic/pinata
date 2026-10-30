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
  backward. Added mean horizontal hem drift to metrics.json (later gated as `windDriftMetres`).
  Added body-frame stills (side, plus front for wind).
- Gates: all pass; windAlignment 0.995. Wind drift silk 0.52 m, wool 0.25 m, leather 0.08 m.
- Observed: body-frame stills separate the materials clearly (silk fans widest, leather a narrow wedge) and the
  rigid control collapses to one line.

## Review (AI judge panel)

Packet: body-frame stills from `reports/p3/`, renamed and shuffled. Key and answers in `docs/plans/p3-judge/`.
3 blind judges, fresh agents, no project context.

| Question | Result | Chance level |
|---|---|---|
| Rank 3 materials lightest to heaviest from turn-stop stills | 3 of 3 judges exact | 1 in 6 per judge |
| Rank 3 materials from wind stills | 3 of 3 exact | 1 in 6 |
| Wind side, one image mirrored to control side bias | 6 of 6 | 1 in 2 each |
| Simulated vs rigid cape, both orders, 2 pairs | 12 of 12 picked simulated, confidence 4-5 | 1 in 2 each |

Caveat: simulated vs rigid is an easy question (the rigid cape does not move), so it shows the motion is visible,
not that it looks natural. The material rankings are the stronger evidence: judges told silk, wool and leather
apart from motion alone, in both scenarios.

## Gate amendment and re-run

The batch C review found several gates also passed for a rigid cape (settle clock started during deceleration, no
lag floor, wind alignment insensitive to drift size, penetration blind to cloth passing through). Gates were
tightened (see "Gate amendment" in the plan); nothing was loosened.

- All gates pass. settle (from root rest, cape only) silk 2.30 s, wool 1.47 s, leather 0.93 s; overshoot silk
  8.9, wool 8.6 degrees (leather 7.8, not gated); lag silk 12, wool 11, leather 2 frames; wind drift silk 0.52 m,
  wool 0.25 m, leather 0.08 m; maxStrain 0.041; no penetration including link midpoints; deterministic.
- Rigid control, same gates: settle 0.008 s, overshoot 0, lag -1. It fails every motion gate, for all materials.
- Thin margins: leather lag rests on a 0.69 degree sideways peak (floor 0.5), and leather drift is 8.4 cm
  (floor 5 cm). Leather is meant to move least, but these are the first gates to watch when anything changes.

## Verdict

P3 passes. Automated gates pass under the tightened set, the rigid control fails them, and the blind judge panel
answered every ground-truth question correctly (material ranking in two scenarios, wind side with a mirrored
control, simulated over rigid). Secondary motion driven by body motion, materials and wind is viable with this
approach.
