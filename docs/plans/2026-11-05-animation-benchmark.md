# Animation Benchmark

How do Piñata's animations stack up against hand-animated game characters, quality for quality? Not to copy a style,
but to know where we stand on what makes character animation good: fluidity, weight, anticipation and follow-through,
secondary motion, contact with the environment, readability, and appeal. The references are CC-licensed, fully
animated pixel-art characters; the measure is a rubric that judges can be shown to apply reliably, plus numbers the
tool can compute.

## References

Kept outside the repository (a fetch script records each source URL and licence; nothing is redistributed):

- [Fantasy Warrior](https://luizmelo.itch.io/fantasy-warrior) (LuizMelo, CC0): side view, a caped warrior, idle 10,
  run 8, jump 3, fall 3, three attacks, take hit, death. Cape and timing in a side-scroller.
- [Huntress 2](https://luizmelo.itch.io/huntress-2) and [Evil Wizard](https://luizmelo.itch.io/evil-wizard) (LuizMelo,
  CC0): side view, hair and robes.
- [8 Directional 2DHD Character](https://hormelz.itch.io/8-directional-char) (hormelz, CC0): eight directions, walk,
  run, idle, jump, roll, attacks, push, damage, death. Directions and turning.
- LPC characters (CC-BY-SA/GPL, the generator's sheets, already used as the calibration control): four directions,
  walk, slash, thrust, cast, hurt, with cape and hair layers.

## Design

- **The rubric.** Seven dimensions, each a 1-5 rating with a one-line anchor per level: fluidity (spacing and easing,
  no pops), weight (contact, squash, the body settling), anticipation and follow-through, secondary motion (cape,
  hair, cloth lag and settle), environment (feet planted, ground contact, shadows, reactions), readability (pose and
  direction at a glance), appeal (would a player want this character). Plus one overall question: which of the two
  would you ship in a game.
- **Like with like.** Each comparison pairs a reference animation with Piñata's closest one (walk or run with run,
  idle with idle, jump with jump, attack with attack), at the same scale and frame rate, as stacked strips and as
  animated GIFs, both orders.
- **Judge validation first.** Before any score counts, the judges must tell a reference from a degraded copy of
  itself on the dimension the degradation hits: frames dropped (fluidity), the cape frozen to its first frame
  (secondary motion), the feet slid by a pixel a frame (environment), the hold frames removed (anticipation). A
  dimension the judges cannot see is reported and left out of the benchmark.
- **Numbers beside the ratings.** Computed on both sides: frames per cycle, distinct poses, the share of frames
  that are holds, the largest pixel change between neighbouring frames (pops), the cape's lag behind the body
  (phase delay of its centre of mass), foot slide on drawn pixels. These need no judge and become regression
  numbers.
- **Output: a scorecard.** Per dimension, Piñata's rating against the references', with the numbers; the weakest
  dimensions become the next plans (the feel layer: anticipation, squash, timing, holds).

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Judges see the dimension | for each dimension kept, the reference is rated above its degraded copy in at least 80% of answers, both orders | dimensions below are reported and dropped |
| Controls | a reference against itself rated within 0.5 on average | the rubric is stable |
| Scorecard | every kept dimension rated for at least four animations (idle, walk or run, jump, attack) against at least two references | measurement, not a pass/fail on Piñata |
| Licences | every reference's source and licence recorded; none in the repository | |
| Existing outputs | byte-identical | the benchmark adds tooling only |

## Batches

- **A. References and rubric:** the fetch script, the references cut to strips and GIFs, the rubric panel kind in
  the judge runner, the degraded copies, the judge-validation gate. Review.
- **B. Scorecard:** the pairings, the numbers on both sides, the panels, the scorecard in this plan's results, and
  the next plans named from the weakest dimensions. Review.
