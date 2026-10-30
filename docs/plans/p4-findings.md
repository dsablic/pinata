# P4 Findings

Gate thresholds are locked (see `pocs/p4-locomotion/gates.ts`); every change after the first run made them stricter.

## Build and fixes before the first full run

- The planned stride (1.3 m) drove the knee to 645 deg/s on the knight's short, straight legs; the starting stride
  became 1.0 m (a rig parameter).
- A geometric slide check measured at the joints would never fire (the toe joint sat 6 cm up, at the centre of the
  foot capsule); feet are measured at the sole, and zero planted frames is a harness error.
- Knee-speed peaks of 640-1040 deg/s after the ground-contact fixes came from three compounding causes, found by
  measurement: a pelvis-drop smoothing window wider than single support (a permanent crouch), a reach limit of 0.99
  that let the knee straighten to 16 degrees where flexion changes fastest, and a fixed 10% vertical swing edge that
  compressed horizontal travel. Fixed in the planner; peaks now 453-518 deg/s.
- Known limits of the planner on this rig: a 0.3 s acceleration ramp gives a 594 deg/s knee peak (thin), and a
  180 degree pivot in 1.0 s gives 659 (fail); scenarios use 0.5 s and 1.5 s.

## Gates tightened after review

- Run 1 passed, but the walk strip showed the sword swinging through the floor: new gate on every non-foot part
  against the ground; the P4 knight's sword tip was raised (asset change).
- The batch C review found `rootSpeedError` compared the root with itself (now measured from the advance of the
  planted feet), a foot hovering just above 2 cm could escape the slide check (new gate: a foot on the ground in
  every frame), the knight stood toe-down so only the toe was measured (toe joints raised; asset change), and the
  skating control was a quarter cycle out of step with the pelvis, so it also locked its legs and popped its knees
  (shifted; it must now pass every gate except slide). Footprint traces were mirrored (fixed).
- Final gates, all pass: slide 0.03 / 0.10 / 0.01 px per frame (walk-turn-stop / slow-fast / pivot); knee peak 453 /
  518 / 492 deg/s; speed error 2.4% / 0.9% / 0.0%; no penetration, reach, knee-limit, alternation or support
  failures; deterministic. Skating control: slide 1.72 px (fails), everything else passes (fair).
- Measurement weakness: `rootSpeedError` needs two plants per foot in each steady window, so short windows or long
  strides return Infinity (seen when trying a 1.2 m stride).

## Judge panels

Round 1 (`docs/plans/p4-judge/`) is superseded: the control was unfair and the footprints mirrored.

Round 2 (`docs/plans/p4-judge/round2/`), 3 fresh judges:

| Question | Result |
|---|---|
| Leg onion skins, ours vs skating, both orders: which feet grip the ground? | 6 of 6 correct, confidence 4 |
| Turn direction from footprints, with a mirrored copy | 6 of 6 correct |
| 48px pixel strips, ours vs skating, both orders: which is a believable walk? | 0 of 6: all judges preferred the skating control, confidence 2 |

On the strips, judges described ours as a shuffle with bunched feet and the control as a clearer stride. The
control differs from ours only in foot placement, so this is a genuine readability result: a kinematically correct,
planted walk does not read as well as smooth leg arcs in 8 small stills. Trying a longer stride (1.2-1.4 m) and
bigger arm swing (30-35 degrees) broke other gates (the sword hit the floor, knee speed, too few plants per speed
window), so readability needs animation-level work (exaggerated contact and passing poses, keeping props clear),
not parameter tuning.

## Verdict

P4 passes on locomotion: a behaviour script compiles into planted, non-sliding, IK-solved footsteps that turn,
change speed, pivot and stop correctly, and blind judges see the grip and the turn. P4 fails on pixel-art
readability of the walk at 48px. Together with P1, this places the remaining risk in the visual layer, not in the
motion.

## Correction: packet assembly bug and strip rerun

The judge packets that stacked or paired images used `-splice` with centre gravity, which inserted the 30 px spacer
through the middle of each image instead of between them. Both sides of every pair were cut the same way, so no
comparison was biased, but legibility suffered (this also affected the P2 difference strips and the P3 pairs, whose
results were unanimous regardless). The P4 strip question was rerun with clean images and fresh judges
(`docs/plans/p4-judge/round3/`): 3 of 6 correct, confidence 1-2, two judges saying the strips look nearly identical.
So the honest result is that 8 small stills cannot show sliding feet at all, rather than a preference for the
sliding control; the gate still fails (majority wrong on one order). The skins spike later showed the walk itself
reads well once drawn with hand-made-looking sprites.
