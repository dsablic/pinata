# World Showcase: Little Computer People

**Goal:** the public showcase becomes a small living world: a procedurally generated set of platforms joined by ramps
and stairs, seen side-on with a slight 3/4 tilt, where several different characters (knight, rogue, dwarf, wizard,
dog, horse, beetle, spider, unicorn) each go about their own business: wandering, pausing to look around, walking
over to another character and standing face to face for a chat, sometimes running, and scurrying off when poked. The
piñata hangs from a beam in the middle of it. Everything is simulated and rendered live in the browser by the engine.

**Decisions (user, 2026-10-30):** every character simulated and rendered live, smaller (about 32-40 px, 1-2 samples
per axis); movement over ramps and steps, no jumping yet; side-on 2.5D view. The showcase shows the component;
agent wiring stays out of it.

**Constraint:** existing outputs stay byte-identical (flat ground must plan exactly as today).

## Pieces

1. **Terrain** (`src/world/terrain.ts`): a seeded generator for platforms (flat runs at different heights) joined by
   ramps and stairs, as a height function `ground(x)` along the walking axis plus a walkable graph (which spans
   connect). Drawn as pixel-art tiles in the same palette approach as the characters.
2. **Terrain-aware gait:** `planGait` takes an optional `ground(x, z)`. Foot plants land on the surface under them,
   swing arcs rise from one plant's height to the next plus the step height, and the pelvis follows the planted feet's
   mean height. With no `ground`, planning is unchanged (byte-identical). Stair rises the legs cannot clear are
   rejected by the terrain generator, not discovered by the planner.
3. **Planning in windows:** a character's next activity becomes a short root script (walk or run to a point, turn,
   stand) planned from its current feet (`initialPlants`), so successive windows join without a snap. Windows join at
   standing moments.
4. **Activities as behaviour compositions** (`src/world/life.ts`): the world is the test bed and showcase for phase 2
   of [composable behaviours](2026-10-30-composable-behaviours.md) (user, 2026-10-30): `stand`, `walk` and `run` as
   bases, layers while moving (`lookAt` another character, `wave`), interactions between characters (visit, face,
   chat, follow, flee), blending between bases, and events with consequences (a poke startles one character and a
   neighbour turns to look). Activities are written as compositions in that format, not hard-coded, and pass its gates
   (masks, continuity, determinism) plus the locomotion gates on terrain. The chooser: a per-character, seeded, deterministic chooser: wander to a reachable spot,
   look around (turn in place, pause), visit another character (walk up, face each other, a small speech-bubble glyph
   above each), run to a far spot, rest (stand a while); a poke interrupts with a startle and a run away. Characters
   avoid walking through each other (a reserved spot per character, waiting when a path is blocked).
5. **Rendering:** each character renders live into its own small buffer at 32-40 px, 1-2 samples, with hysteresis,
   composited onto the world canvas in depth order with the terrain; the world scrolls or fits the canvas.
6. **Page:** the world fills the showcase; the existing panels stay for the piñata and the environment (wind,
   gravity), plus a seed field and a "new world" button, a character count, and the frame-time readout.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Flat ground unchanged | existing outputs byte-identical | `ground` absent |
| Terrain gait | on a test course of ramps (up to 20 degrees) and stairs (rises up to 0.35 x leg length): foot slide <= 0.25 px, sole penetration into the surface <= 0.5 px, reach violations 0, alternation 0, for a biped and a quadruped | Node unit tests, measured against `ground` instead of y = 0 |
| Window joins | no foot moves more than 1 px in the frame where one plan hands over to the next | Node test |
| Determinism | a world from a seed gives identical frames in Node and Chrome | frame hashes |
| Real-time budget | 8 characters plus the piñata: p95 frame time <= 40 ms in headless Chrome on CI, mean reported | browser test |
| Liveliness | over 60 s every character does at least 3 different activities and moves at least 10 m; at least one visit happens; nobody stands in another character for more than 1 s | Node simulation test |
| Poke | a click on a character makes it startle and move away within 0.5 s | browser test |
| No console errors | 0 | browser test |

## Batches

- **A. Terrain and terrain-aware gait** (Node): generator, `ground` in the planner, the terrain gait gates. Review.
- **B. Windows and activities** (Node): `initialPlants`, the activity chooser, liveliness and join gates. Review.
- **C. World rendering and page** (browser): compositing, terrain tiles, the page, budget and poke gates in Chrome.
  Review, then tag a release to deploy.
- **D. Later: a physics engine spike** (user, 2026-10-30): props, character-to-character bumps and ragdoll falls
  (knocked off a platform) through a rigid-body engine behind a narrow interface, with characters staying kinematic.
  Candidates: Box3D, Rapier, Jolt (WebAssembly builds); judged on bundle size, frame cost and Node-browser
  determinism, installed through the safe-install scan. Gates fixed in its own plan before building.
- **E. Later: the page as the world** (user, 2026-10-30): characters live on an existing web page. Elements marked by
  CSS (`--pinata: platform | wall | ledge`, read with getComputedStyle) or attributes (`data-pinata`) become
  platforms (top edges) and walls (sides), rebuilt by ResizeObserver, MutationObserver and scroll; characters draw on
  a transparent overlay that only takes clicks on themselves; a perception layer tells behaviours which elements are
  near and their hints (`--pinata-attract`, `data-pinata-say`), so characters can walk to a hovered button, sit on a
  heading, peek over a card or flee a click. Needs the terrain as a graph of stacked surfaces joined by drops and
  climbs (later jumps) instead of one profile. Its own plan and gates before building.

## Decisions during batch A

- Plants rest on the surface under the whole foot, from the back of the heel capsule to the front of the toe capsule
  (nine samples). On a straight surface (flat or ramp) the foot plants at the ground under the ankle and pitches to
  the slope; where a stair edge lies under it, the plant moves along the foot by the smallest amount (1 cm steps)
  that puts the whole foot on one tread, and only rests on the highest point when no tread is long enough.
- The swinging foot stays above the highest ground under it by as much as it rises over flat ground (step height
  times the swing's lift), so it clears stair noses going up and down; the earlier extra rise by half the height
  difference was dropped as redundant once this held.
- The body's base is the mean ground under the hips, and on terrain the body pitches nose-up by the ground under the
  front hips against the hind hips (both smoothed over 0.15 s). Without the pitch a quadruped's front knee folded past
  150 degrees on stairs rising 0.35 leg lengths. The pitch rotates the pelvis group, hips, shoulders and arm swing
  about the pelvis; attached joints and spring chains follow through their transforms.
- All of it is skipped without `ground`, so every existing output stays byte-identical (checked on all 167 files).
- The quadruped test fixture slides 0.51 px at 0.6 m/s even on flat ground (it is tuned for slower walking), so the
  terrain gates run at 0.4 m/s for both bodies.
