# Jump Takes

The page's jumps are procedural: the landing dip doubles as a 0.18 s crouch, the body flies a ballistic arc with the
walk clip's legs reaching down, and lands with the dip. The [natural-motion plan](2026-11-02-natural-page-motion.md)
(batch D) leaves one piece: capture takes for the take-off and landing. CMU subject 16, the performer of the walk
clips, has standing two-foot jumps (trials 1-2 jump, 3-4 high jump, 5-10 forward jump; 0.05 to 2.4 m across), each a
crouch of 0.3 to 0.5 s, a flight of 0.4 to 0.6 s and a landing that absorbs over about 0.4 s.

## Design

- **The takes.** The forward jumps and the high jumps join `motion/takes.json` and `motion/clips/`. Each is cut into
  three phases from its contacts and root height: the crouch (from the root first dropping below standing to the last
  frame with both feet down), the flight (no foot down) and the landing (first foot down until the root is back near
  standing height).
- **Played, not matched.** Jump takes are never matching candidates, so walking cannot pick them. When the walker
  commands a jump the player picks the take whose flight best fits the jump (run and rise relative to the leg
  length), blends into its crouch, plays the crouch warped onto at most 0.4 s (faster than capture speed when it is
  longer: the captures' 0.6 to 0.9 s wind-up is far longer than the anticipation of a game's jump), plays the flight
  warped onto the arc's duration, and plays the landing at the take's own speed before blending back into matching.
  The crouch replaces the procedural crouch for jumps; falls keep the procedural dip.
- **The body stays the player's.** The arc, the body's position and the ground stay as now; the take gives the
  limbs and the pelvis's drop below standing (scaled by leg length) during the crouch and landing. During flight the
  feet are still lifted over the target's top, so the jump gates hold.
- **One jump kind for both.** Leg jumps and super jumps both use the takes; a super jump's longer flight is the same
  flight played slower.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical in every run without a jump: `npm run rendering-panel`, and the standing, landing and flicker gates' numbers | jump takes are not candidates |
| Walking never plays a jump take | over the standing and jumps gates' runs, a jump take's frame plays only between a jump command and the end of its landing | |
| Jumps | `npm run gates -- --jumps` and `--super-jumps` met as before (at least 95% land on their target, nobody climbs above the jump height, no sole under a surface) | |
| Landings | `npm run gates -- --landings` met as before | falls are unchanged |
| A real crouch | in every planned jump, the pelvis drops at least 10% of the leg length below standing before lift-off, and the arms move: a wrist travels at least 15% of the arm's length between crouch and flight | measured on the player's frames |
| Cost | at most 8 ms of main thread per frame at p95 in Chrome, four characters | |
| Looks better | a blind panel of jump strips (crouch, flight and landing in eight frames) of each character, the takes against the current procedural jump, three judges on three models, both orders, the stacked layout, controls: the takes preferred in at least 2/3 of non-control answers | |

## Batches

- **A. Takes and the player:** fetch and cut the takes, the jump track in the player, the gates above except the
  panel. Review.
- **B. The panel:** jump strips in the rendering panel's finders, the judge round; release if met. Review.

## Results

### Batch A: takes and the player (the look is batch B's panel)

Three takes of subject 16 join the clips as `kind: 'jump'`: `jump-forward-5`, `-7` and `-10` (trials 5, 7 and 10),
each cut with a per-take `range` to a few frames before the crouch through the landing settling plus three frames.
A fourth, a high jump (trial 3), was cut and dropped: no jump the page makes chose it. Existing clips convert
byte-identically. A take plays from 3 frames before the root's final descent into the crouch, the crouch warped onto
at most 0.4 s.

| Gate | Result |
|---|---|
| Existing outputs | **Met.** `npm run rendering-panel`: `diff -r` of `reports/rendering-panel` against the copy saved before any change is empty and its log is identical. `npm run gates -- --landings`: identical. The full `npm run gates` against the output saved before any change: the flicker lines and the standing lines on page-test, perception, demo-1200 and demo-390 are identical; the standing lines on the jump page, which has jumps, move (planted feet off 30 of 5283 frames before, 32 of 5389 after; mid-air 50 of 5759, 60 of 5759; both gates were missed before too) along with the jump lines |
| Walking never plays a jump take | **Met.** `npm run gates -- --jump-takes`: 0 take frames outside a jump command to the end of its landing (a take run may go on after touchdown for the take's settle minus land at the player's speed plus a frame, so a take that never hands back fails), over every walker frame of the jumps gate's runs (127, 105, 79 and 130 planned jumps for the knight, rogue, dwarf, wizard). Jump takes are also not entries or candidates, which a test holds. The standing gates' cast runs record no clip names, so the check does not run on them |
| Jumps | **Met.** All four characters at 100% of planned jumps landed, no climbs, deepest sole 0.0 cm; 83, 63, 51 and 86 trips (gate: 40; 90, 69, 53 and 93 with the dip). The recorded jump page is unchanged at 25, 15, 6 and 28 trips |
| Super jumps | **Met on page-test, demo-1200 and demo-390; missed on perception**, as the gate stood before. Page-test 6 of 6 planned landed (5 with the dip), demo-1200 5 of 5 (8), demo-390 15 of 15 (14); perception 1 of 1 against the gate's minimum of 4 (2 before; missed before too). Deepest sole 0.00 px; every planned jump lands. The count is the number of nodes the wandering picks in 60 s and shifts with every change to the takes' timing (page-test has been 3, 4 and 6 across timings), so a pass here has no margin |
| Landings | **Met**, output identical |
| A real crouch | **Met.** Smallest pelvis drop below rest height before lift-off, over every planned jump: knight 18.4% of its 0.70 m leg, rogue 24.4% of 0.44, dwarf 21.7% of 0.34, wizard 20.1% of 0.79 (gate 10%). Smallest wrist travel relative to the pelvis between the lowest pelvis and the first frame in the air: 75.3% of the knight's 0.45 m arm, 145.4% of 0.35, 144.3% of 0.30, 75.0% of 0.54 (gate 15%). Rest height stands for standing; the characters' standing poses are up to 1.6 cm (the wizard) under it, which flatters the drops by up to 2% of a leg |
| Cost | **Met for walking only.** `npm run site && npm run test:browser` passes with p95 5.20 ms (page) and 5.70 ms (demo page) over 182 and 183 frames, four characters (earlier runs 4.70 to 6.30 ms); gate 8 ms. The Chrome layouts have no leg-length jumps, so no frame of the run plays a jump take and the cost of a jump frame in Chrome is not measured |
| `npm run typecheck`, `npm test` | Pass (708 tests) |
| Looks better | Not measured: batch B |

Known limits, not fixed in this batch:

- Only `jump-forward-10` and `-7` are chosen in the gates' runs (knight 58 and 43 starts on the synthetic grounds,
  rogue 90 and dwarf 73 of `-10`, wizard 58 of `-7` and 43 of `-10`); `jump-forward-5` is chosen for a run under about
  0.4 m with almost no rise. The super jumps (every character picks `-10` at rises of 1.5 to 6 m) use the take of the
  longest run.
- A jump takes about 1.1 s from command to the end of its landing (the crouch at most 0.4 s, the dip's 0.18 s), so
  fewer jumps are planned in a given time than with the dip.
- A fall that starts during a take's crouch, or a flight that overruns `arc.seconds`, loses the procedural reach-down
  and dip. A super jump lands with the take's small-jump landing whatever the height.
- The look of the take's flight (the legs stay the take's own, lifted over the target, and do not reach down as in a
  fall) has not been judged; batch B's panel does.
