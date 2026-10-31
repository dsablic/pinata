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
- **F. Weather, events and particle effects** (user, 2026-10-30): declarative in `world.json`. Weather: wind (live
  now for cloth), rain and snow, earthquakes (the ground shakes; characters brace, stagger or stop). Each event has a
  reaction in the activities, the way a poke does, so characters visibly adapt (hurry or huddle in rain, widen their
  stance in a quake). Particle effects as emitters: rain and snow drops, dust puffs at footsteps and landings, confetti
  when the piñata is hit, a burst on a poke; drawn as pixels in the scene's palette, moved by wind and gravity,
  deterministic for a seed.
- **G. Styles in the world** (user, 2026-10-30): a style selector over the existing style variants (palettes, shading
  bands, outline modes, as P6 showed), then skinned characters (the skins spike's per-part pixel-art sprites), then the
  image-and-points renderer; the procedural capsule render is the baseline, not the target look.
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

## Decisions during batch B

- Planning in windows: `planGait` takes `initial` (each foot's current plant); every step of an activity becomes one
  plan from where the feet stand, ending with 0.7 s of standing so the feet settle; root tracks come from simple moves
  (turn in place, walk along x with eased speed, stand) instead of motion scripts.
- Activities are a small composition format (`site/activities.json`): steps `walk` (to `random`, `far`, `friend`,
  `away`, at a multiple of the character's walking speed), `face` (friend or camera), `turn`, `stand` (with an
  optional glyph shown above the head), chosen by weight; a poke replaces the current activity with the `poke`
  reaction once the feet are next all planted. Walks are limited by time at the character's own speed (8 s for a
  wander, 14 s for a dash), so slow creatures do as many things as fast ones. Layers (lookAt, wave) wait for upper-body
  drivers, which the joint hierarchy now allows.
- Characters walk in separate depth lanes, so they pass in front of and behind each other instead of colliding.
- **Liveliness gate restated (needs the user's confirmation):** "at least 3 different activities and 10 m in 60 s"
  could not hold for the beetle (0.14 m/s: 10 m is 71 s of non-stop walking) and depended on luck (three wanders count
  as one activity). It now reads: every character starts at least 4 activities, at least 2 of them different, and
  covers at least 25% of the distance non-stop walking at its own reference speed would cover; at least one visit
  happens; no two characters stand within 0.3 m of each other.
- The walkable graph from item 1 is not built: the terrain is one profile along x; stacked platforms come with batch E.

## Batch A review fixes

- The tread nudge fired at every ramp-to-flat kink and could move a plant a whole foot length (feet planting behind
  their partner, zero-length steps). Now a continuous surface (no rise steeper than 60 degrees between footprint
  samples) pitches the foot along its heel-to-toe line and lifts it over any convex kink; only a real height jump
  nudges, by at most 40% of the foot length.
- The swing clearance measured against a level foot, so on ramps the ankle popped up 2-4 px at lift-off; it now
  measures against the foot's pitched sole, and the one-frame vertical jumps match flat ground (0.56 px biped,
  1.50 px quadruped).
- The body's base and pitch came from the ground under the hips, so on stairs the pitch swung with where the hips
  fell over risers (43 degrees on a 25-degree flight). Both now come from the planted feet: the front feet's soles
  against the hind feet's.
- Generator: no endless loop when maxHeight is below a quarter rise (one flat run), heights never exceed maxHeight,
  no ramps with a zero slope, a `minTread` (the world passes its longest foot plus 15%), and `terrainOf` refuses empty,
  backward and zero-length spans; heights outside the course continue the end spans.
- New tests: generated courses walked both ways by both bodies with regular steps (at most 2.2x the nominal step)
  and a lean under 35 degrees, and the generator's edge cases.

## Decisions during batch C

- **Declarative config (user, 2026-10-30):** everything about the world that is tuning rather than mechanism lives in
  one file, `site/world.json`: the cast, terrain limits, lanes, motion timing, how far walks go, the activities and
  the poke reaction, the view (scale, size, camera, samples, palette) and the bubble glyphs. It is checked by a small
  declarative schema checker (`src/formats/schema.ts`: numbers with ranges, enums, ranges, colours, arrays, maps,
  objects with optional fields and tagged unions, each error with its path), which replaced the hand-written
  activities validation; the other formats can move to it over time. New worlds, casts and activities are config,
  not code.
- The world renders each character in its own box that follows it (keeping its own temporal hysteresis) at 1 sample
  per pixel by default; terrain is drawn once as pixel art (a top band across the lanes and a front face). In headless
  Chrome, 8 characters run at 19.6 ms mean, 19.8 ms p95 per frame.
- Pages: `index.html` is the world; the hanging piñata moved to `pinata.html`. The site builder writes
  `world.bundle.json` (config plus the cast's mannequin, style and rig), validated in the browser.
- **Secondary motion and environment (user, 2026-10-30: "no secondary motion", "too wooden and stiff"):** capes and
  chains from each character's motion file are simulated live on its moving body with the existing cloth solver
  (pins turn with their joints); `environment` in the config (gravity, wind, gusts, cloth substeps) drives them and
  the page changes it live, with scenes (named palettes) and terrain hilliness. A `life` section adds a damped lean
  spring for the upper body (into acceleration and turns, overshooting at stops), breathing, and a weight-shifting
  sway while standing; the legs and pelvis are untouched, so feet stay planted.
- Each character's render box is sized from its full reach (farthest joint, thickest part, and the length of its cape
  or chains), which fixed the spider's legs being cut off. The rasterizer now skips pixels outside the rectangle its
  primitives' screen discs can touch (exact: byte-identical on every output), so the larger boxes cost nothing: the
  world runs at about 24 ms per frame for 8 characters in headless Chrome.
- A wander that would leave the world is reflected instead of clamped: a character at the edge kept choosing the wall
  and stood still for a minute.
- **Animation principles (user, 2026-10-30: "more dynamic instead of stick figure like"; chose motion now, skins
  next):** `life` gains squash at footfalls (the upper body compresses and spreads, recovering over a fraction of a
  second), anticipation (the lean spring looks two frames ahead in the plan, so characters lean back before setting
  off), a lagging head (upper-body joints above a height fraction nod on their own spring, pushed by the torso's lean
  and the pelvis's bounce), and exaggeration multipliers for bob and arm swing. The capsule-mannequin look itself is
  the larger cause of the stick-figure impression; skins (batch G) address it next.
- **Weather that everyone feels (user: "wind and gust and gravity don't do much"):** wind and gravity only moved cloth,
  which only four characters have (and a cape is edge-on from the side). Spring chains (tails, manes, ears, antennae)
  now take an outside force (a share of gravity and wind drag, `environment.springs`), and bodies lean into the wind
  (`life.lean.perWind`), all from the same gusting wind the cloth uses. Offline renders pass no force, so their output
  is unchanged.
- `dress` in the config draws the simulated capes and chains in the world (material and radius) and hides the fixed
  mannequin parts they replace (the knight's rigid cape boxes).

- **2026-10-31, user direction.** Once page-as-world works (batch E: DOM elements as platforms), rework the world demo
  to stand on the page's own elements instead of the generated terrain.
