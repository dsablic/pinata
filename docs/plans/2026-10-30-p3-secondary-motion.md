# P3 Secondary Motion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan in batches.

**Goal:** Prove that cloth and hair driven by the body's motion read as inertia (lag, overshoot, settle), that
materials and wind are distinguishable by motion alone, and that the simulation is stable, collision-free and
deterministic. Design: [`docs/plans/2026-10-30-viability-design.md`](2026-10-30-viability-design.md), section "P3 Secondary motion".

**Architecture:** The P1 knight is the collision body, moved as a rigid whole by a scripted root transform (position
plus yaw). A cape (a particle grid) and a plume (a particle chain) are pinned to body anchors and simulated with
XPBD (extended position-based dynamics): fixed substeps, distance constraints with per-material compliance, gravity,
wind with deterministic gusts, air drag, and collision against the body's signed distance field (the P1 SDFs).
Metrics and still images come from the particle history. No pixel-art rendering in P3: motion is judged from
traces, onion skins and plots.

**Tech stack:** as P1 (Node 24, TypeScript type stripping, `node:test`, no runtime dependencies). Conventions are in
the P1 plan header.

**Plan style:** unlike P1, tasks give interfaces, algorithms and test cases rather than complete code. Implementers
write the code test-first; each batch is reviewed (spec first, then quality).

---

## Conventions

- Units: metres, seconds, kilograms. Y up; the knight faces +Z at yaw 0; yaw rotates about +Y, positive turns the
  knight's front toward +X.
- Output frame rate 24 fps. Simulation substep `1/960 s` (40 substeps per frame; 10 left the cape stretched past
  the strain gate after collisions). Both live in the scenario file.
- Determinism: no `Math.random`, no time-dependent input, fixed iteration order. Gusts come from a fixed sum of
  sines of simulation time.

## Gates (locked before implementation; rationale recorded in `gates.ts`)

Scenarios: `turn-stop` (walk, 90 degree turn, stop, hold), `wind` (idle in gusty wind), `soak` (turn-stop looped to
1000 frames). Each runs once per material in `silk`, `wool`, `leather`.

| Gate | Threshold | Rationale |
|---|---|---|
| nonFinite | 0 | Any NaN or Infinity is a blow-up. |
| maxSpeed (soak) | <= 15 m/s | A cape tip faster than about 3x a sprint means the solver is injecting energy. |
| maxStrain | <= 0.10 | Cloth stretched more than 10% beyond rest length reads as rubber. |
| penetratingFrames | <= 1% | Fraction of frames with any particle deeper than 0.5 px (at 48px scale) inside the body. |
| settleSeconds | each in [0.2, 3.0], and silk > wool > leather | After the stop, time until max particle speed < 0.05 m/s (wind off). Real capes settle in about a second; heavier, stiffer materials settle faster. |
| overshootDegrees | >= 5 for silk and wool | After the stop, the forward swing angle (below) passes its final rest value by at least 5 degrees: visible follow-through. |
| lagFrames | >= 1 for all materials | The peak of the absolute sideways swing angle comes at least one frame after the peak of the body's turn rate. |
| windAlignment | >= 0.7 | Mean cosine between the horizontal hem displacement (from windless rest) and the wind direction during the wind scenario. |
| nondeterministicFrames | 0 | Particle positions hashed per frame match a re-run in a child process. |

Swing angles (amended after the batch B review, before batch C): take the hem centroid relative to the cape's
top-centre anchor, in body-local space (`R(-yaw) * (hem - anchor)`). Forward swing = `atan2(local z, -local y)`,
positive when the hem swings toward the body's front. Sideways swing = `atan2(local x, -local y)`. These are the
pendulum angles of the cape about its top edge. The first definition (yaw of the horizontal anchor-to-hem vector)
was undefined for a cape hanging straight down: the horizontal vector is a few millimetres long and its yaw is noise.

Material values in Task C3 are starting points only. The batch B review measured that the settle order is decided
by `damping + drag / mass` per material, so tuning those values (within the locked gates) is expected and is logged
in the findings file.

## Judge panel (secondary, after the gates pass)

Ground-truth questions only (see the AI judge panel section of the design):
1. Material ranking: three anonymised top-down hem traces (one per material, same turn) -> "rank from lightest to
   heaviest cloth". Truth: silk, wool, leather.
2. Wind: side-view onion skin of the wind scenario -> "which side does the wind blow from?". Truth: from the
   scenario.
3. Inertia A/B: simulated cape vs a rigid control (the cape glued to the body, no simulation), as onion skins of the
   same turn, both orders -> "which looks like real cloth?". Truth: simulated.
Pass: majority correct on each question, and the rigid control is never preferred by a majority.

---

## Batch A: motion script and formats

### Task A1: Root motion script ([`src/motion/script.ts`](../../src/motion/script.ts))

Types:

```ts
export type Segment =
  | { action: 'move', speed: number, duration: number }   // m/s along the current facing
  | { action: 'turn', degrees: number, duration: number } // yaw change, while keeping the current speed
  | { action: 'hold', duration: number }                  // decelerate to 0, then stand
export type Script = { segments: Segment[], accelSeconds: number }
export type RootState = { position: Vec3, yaw: number, velocity: Vec3, angularVelocity: number }
export function rootAt (script: Script, t: number): RootState   // reference; integrates from 0 on every call
export function createRootTrack (script: Script): (t: number) => RootState   // precomputed, for the simulation
export function scriptDuration (script: Script): number
```

Behaviour:
- Speed changes (start of `move`, start of `hold`) ease with smoothstep over `accelSeconds`, so acceleration is
  finite.
- `turn` eases yaw with smoothstep over its duration; speed carries over from the previous segment.
- Position is the integral of speed along the facing direction. Integrate numerically with a fixed internal step
  (1/960 s) from t = 0. `createRootTrack` precomputes positions on that grid once, so sampling at 240 Hz is cheap,
  and both it and `rootAt` stay pure functions of `t`.
- Scenario scripts must end with a `hold` (enforced in A2), so the velocity never drops to zero abruptly.
- After the last segment the root stays at its final state with zero velocity.

Tests: zero-length script stays at the origin; `move 1 m/s for 2 s` with `accelSeconds 0` ends at z = 2; with
`accelSeconds 0.5` ends slightly short of 2 and velocity is continuous (sample at 1 ms steps, no jump above
`speed * 1ms / accelSeconds * 2`); `turn 90` ends at yaw = pi/2 and faces +X; `hold` ends with zero velocity;
calling twice with the same `t` gives identical results.

### Task A2: Simulation materials and scenario formats ([`src/formats/sim.ts`](../../src/formats/sim.ts))

```ts
export type SimMaterial = {
  name: string
  particleMass: number      // kg
  stretchCompliance: number // m/N (XPBD alpha), >= 0
  bendCompliance: number    // m/N, >= 0
  damping: number           // 1/s, >= 0
  drag: number              // N per (m/s) per particle, >= 0
}
export type Cape = {
  anchorLeft: string, anchorRight: string // joint names on the body
  columns: number, rows: number           // particle grid, >= 2 each
  length: number                          // metres, top to hem at rest
  material: string
}
export type Chain = { anchor: string, links: number, linkLength: number, direction: Vec3, material: string }
export type Wind = { direction: Vec3, speed: number, gust: number } // gust: fraction of speed, 0..1
export type Scenario = {
  name: string
  body: string                 // path to a mannequin JSON, relative to the scenario file
  bodyExcludeParts: string[]   // parts that are not colliders (the old rigid cape, the plume)
  script: Script
  cape?: Cape
  chains: Chain[]
  wind?: Wind
  gravity: Vec3
  fps: number
  substeps: number
  particleRadius: number
  durationSeconds?: number     // defaults to the script duration plus 3 s
}
```

Validators follow the P1 pattern (`Validated<T>`, unknown keys rejected, actionable messages), plus a cross-check
`checkScenario(scenario, mannequin, materials)` for joint names, excluded part names and material names. Tests in
the style of [`test/mannequin.test.ts`](../../test/mannequin.test.ts).

Commit after each task. Review batch A, then continue.

## Batch B: body collider and particle system

### Task B1: Body collider ([`src/sim/body.ts`](../../src/sim/body.ts))

```ts
export type Collider = { distance: (p: Vec3) => number, normal: (p: Vec3) => Vec3 }
export function bodyCollider (m: Mannequin, exclude: string[], root: RootState): Collider
export function anchorWorld (m: Mannequin, joint: string, root: RootState): Vec3
```

The distance is the union (minimum) of the included parts' SDFs, evaluated in body-local space
(`local = R(-yaw) * (p - position)`). Cull by bounding sphere: skip a part when the distance to its bounding sphere
already exceeds the current minimum. The normal is the central-difference gradient in local space, rotated back to
world space. Reuse [`src/raster/sdf.ts`](../../src/raster/sdf.ts) and [`src/raster/bounds.ts`](../../src/raster/bounds.ts).

Tests: a point 1 m in front of a sphere part at the origin has distance 1 - r and normal +Z; the same with
`yaw = pi/2` faces +X; excluded parts don't collide; `anchorWorld` rotates and translates joints.

### Task B2: Particle system builders ([`src/sim/cloth.ts`](../../src/sim/cloth.ts))

```ts
export type Particles = { position: Float64Array, previous: Float64Array, inverseMass: Float64Array, count: number }
export type DistanceConstraint = { a: number, b: number, rest: number, compliance: number }
export type Pin = { particle: number, joint: string, offset: Vec3 } // offset in body-local space
export type System = { particles: Particles, constraints: DistanceConstraint[], pins: Pin[], material: SimMaterial[] }
export function buildCape (cape: Cape, m: Mannequin, material: SimMaterial): System
export function buildChain (chain: Chain, m: Mannequin, material: SimMaterial): System
export function mergeSystems (systems: System[]): System
```

Cape: a `columns x rows` grid hanging straight down from the line between the two anchors (in body-local rest
pose), with the top row pinned (inverse mass 0) at offsets interpolated between the anchors. Constraints:
structural (horizontal and vertical neighbours, stretch compliance), shear (both diagonals, stretch compliance) and
bending (neighbours two apart horizontally and vertically, bend compliance). Chain: `links + 1` particles from the
anchor along `direction`, the first pinned, structural plus bending (two apart). The material per particle is kept
so metrics and drag can look it up (store an index per particle if simpler; document the choice).

Tests: particle and constraint counts for a 3 x 4 cape; rest lengths match the grid spacing; the top row is pinned
and nothing else is; merging offsets indices correctly.

### Task B3: XPBD solver ([`src/sim/solver.ts`](../../src/sim/solver.ts))

```ts
export type Environment = { gravity: Vec3, wind?: Wind, particleRadius: number }
export function windAt (wind: Wind | undefined, t: number): Vec3
export function step (system: System, env: Environment, body: Mannequin, exclude: string[],
  track: (t: number) => RootState, t: number, dt: number): void
```

(`step` has more than 5 parameters; group them in an options object per the conventions.)

Per substep:
1. Sample `track(t)` (from `createRootTrack`, never `rootAt`) and move pinned particles to their anchor positions
   in world space for that root state.
2. For free particles: `v = (x - previous) / dt`; apply gravity; apply drag toward the wind velocity
   (`a += drag * inverseMass * (wind - v)`); apply damping (`v *= max(0, 1 - damping * dt)`); `previous = x`;
   `x += v * dt`.
3. Solve distance constraints once each in array order (XPBD with per-substep lambda reset:
   `alphaTilde = compliance / dt^2`, `dLambda = (-C - alphaTilde * lambda) / (wA + wB + alphaTilde)`).
4. Collision: for each free particle, if `distance(x) < particleRadius`, move it out along the normal to
   `particleRadius`.

`windAt`: `direction * speed * (1 + gust * (0.6 sin(1.3 t) + 0.3 sin(3.1 t + 1) + 0.1 sin(7.7 t + 2)))`,
direction normalised.

Tests: a 10-link chain pinned at the top, no wind, settles (after 5 s) hanging straight down with each link within
2% of rest length; a free particle above a sphere ends outside it; with damping 0 and no drag a pendulum keeps most
of its energy over 1 s while with damping 2 it loses most; stepping two identical systems gives identical bytes;
pinned particles follow a moving root.

Commit after each task. Review batch B, then continue.

## Batch C: metrics, stills and runner

### Task C1: Simulation recorder and metrics ([`src/sim/metrics.ts`](../../src/sim/metrics.ts))

A recorder stores, per output frame: time, root state, all particle positions (copied), and per-particle
penetration depth (`particleRadius - distance` when positive). Metrics, each a pure function of the recording:
`nonFinite`, `maxSpeed`, `maxStrain` (over all constraints, `(length - rest) / rest`), `penetratingFrames`
(fraction of frames with any depth above a given threshold in metres), `settleSeconds(fromTime, speedThreshold)`,
`swingAngles` (forward and sideways per frame, as defined in the gates section), `overshootDegrees(stopTime)`,
`lagFrames(turnStart, turnEnd)`,
`windAlignment(restHem)`, and `frameHashes` (sha256 of each frame's positions). Test each with small synthetic
recordings whose answers are known.

### Task C2: Drawing primitives and P3 stills ([`src/diagnostics/draw.ts`](../../src/diagnostics/draw.ts), [`src/diagnostics/motion-images.ts`](../../src/diagnostics/motion-images.ts))

`draw.ts`: `line(img, x0, y0, x1, y1, rgb)` (Bresenham), `disc(img, cx, cy, r, rgb)`, and
`plot(series: Array<{ values: number[], rgb: number }>, options: { width, height, yMin, yMax })` returning an Image
with axes. `motion-images.ts`: `topDownTrace` (body path plus hem centroid path, seen from above), `sideOnionSkin`
(every Nth frame of the cape and body silhouette from the side, older frames lighter), `angleChart` (swing angle and
body yaw over time). Body silhouettes come from the collider: sample the body's distance on a coarse grid in the view
plane; that is enough for stills. Tests: line endpoints and length, plot axes inside bounds.

### Task C3: P3 assets, gates and runner ([`pocs/p3-secondary-motion/`](../../pocs/p3-secondary-motion))

- `materials.json`: `silk`, `wool`, `leather`. Starting values (to be tuned only within the gates, logged in a
  findings file): silk mass 0.01, stretch 1e-6, bend 1e-3, damping 0.3, drag 0.02; wool mass 0.02, stretch 1e-7,
  bend 1e-4, damping 0.5, drag 0.015; leather mass 0.04, stretch 1e-8, bend 1e-5, damping 1.0, drag 0.01.
- `turn-stop.json`, `wind.json`, `soak.json`: body `../p1-static-style/knight.json`, excluding `capeL`, `capeR`,
  `plume`; a cape between new body anchors (add `capeAnchorL`/`capeAnchorR` joints to a copy of the knight in
  [`pocs/p3-secondary-motion/knight.json`](../../pocs/p3-secondary-motion/knight.json) rather than changing P1's file); a plume chain from the helmet top.
- `gates.ts`: the gate table above with rationales.
- `run.ts`: runs every scenario for every material, records, computes metrics, evaluates gates, writes
  `reports/p3/` (`metrics.json`, `summary.txt`, stills per scenario and material, a rigid-control onion skin for the
  judge panel), checks determinism in a child process the way P1 does, and uses P1's exit-code contract (0 pass,
  1 gate failed, 2 harness error, a stale report is cleared at the start).

Review batch C, then run the judge panel (controller task) and log findings in [`docs/plans/p3-findings.md`](p3-findings.md).

## Gate amendment (after the batch C review, all gates passing)

The batch C review showed that several gates also pass for a rigid cape that never moves. These changes only make
the gates stricter; no threshold is loosened.

- `settleSeconds`: the clock starts when the root comes to rest (start of the final hold plus `accelSeconds`), not at
  the start of the hold, and only cape particles count (the plume is a separate object). The [0.2, 3.0] range and
  the silk > wool > leather order are unchanged.
- `lagFrames`: only counts when the peak absolute sideways swing in the window is at least 0.5 degrees; otherwise it
  is -1 (fails the >= 1 gate). Noise-level swings no longer produce a lag.
- New gate `windDriftMetres >= 0.05` per material: mean horizontal hem drift from the windless rest during the wind
  scenario. `windAlignment` stays, but alone it only checks the sign of the drag.
- `penetratingFrames` also samples the midpoint of every constraint between two free particles, so cloth passing
  through the body counts, not only particles left inside it.
- New gate `rigidControlFails >= 1` per material: the rigid control (cape at rest pose moved with the body, no
  simulation) is run through the motion gates (settleSeconds minimum, lagFrames, overshootDegrees at the material's
  threshold or 5 degrees if the material has none) and must fail at least one of them. A gate set that a rigid cape
  passes proves nothing about motion.
