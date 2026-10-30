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
4. **Activities** (`src/world/life.ts`): a per-character, seeded, deterministic chooser: wander to a reachable spot,
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
