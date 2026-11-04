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
  length), blends into its crouch, plays the crouch at the take's own speed, plays the flight warped onto the arc's
  duration, and plays the landing at the take's own speed before blending back into matching. The crouch replaces the
  procedural crouch for jumps; falls keep the procedural dip.
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
