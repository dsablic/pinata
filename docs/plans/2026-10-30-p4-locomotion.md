# P4 Locomotion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan in batches.

**Goal:** Prove that a behaviour script (walk, turn, stop, idle) compiles into believable locomotion: feet planted
without sliding, legs solved by IK within joint limits, no knee pops, root speed matching the script, readable from
several directions. Design: `docs/plans/2026-10-30-viability-design.md`, section "P4 Planner and IK".

**Architecture:** A pose is a map of joint positions in body-local space (no bone hierarchy). A rig file says which
joints form each leg and arm and which move rigidly with the pelvis. Each frame, the gait planner turns the root
track (reused from P3's `createRootTrack`) into world-space foot targets: the stance foot stays where it landed, the
swing foot arcs to a target predicted from the root's position and yaw at landing. Step phase advances with distance
travelled, so slower walking takes shorter steps in time, not faster feet. Two-bone analytic IK places each knee,
the arms swing opposite the legs, and the pelvis bobs. Because mannequin parts reference joints by name, a posed
frame renders through the P1 rasterizer and stylizer unchanged.

**Tech stack and conventions:** as P1 and P3. Plan style as P3: interfaces, algorithms and test cases; implementers
write code test-first; each batch is reviewed.

---

## Conventions

- Units, axes and yaw as P3 (Y up, the knight faces +Z at yaw 0, positive yaw turns the front toward +X).
- 24 fps output. The gait is evaluated per output frame (it is kinematic, no substeps).
- The ground is the plane y = 0.
- Body-local to world: `world = R(yaw) * local + rootPosition`, as `toWorld` in `src/sim/body.ts`.

## Gates (locked before implementation)

Scenarios: `walk-turn-stop` (accel, walk 1.2 m/s, 90 degree turn while walking, walk, stop, idle 2 s),
`slow-fast` (walk 0.6 m/s then 1.6 m/s, stop), `pivot` (turn 180 degrees in place, then walk). Height 1.8 m; the
pixel scale for slide limits is 48 px per 1.8 m.

| Gate | Threshold | Rationale |
|---|---|---|
| footSlidePx | <= 0.25 px/frame | Horizontal movement of a planted foot point (ankle or toe within 2 cm of the ground for two consecutive frames), at 48px scale. Sliding feet are the classic tell of broken locomotion. Measured from geometry, not from the planner's stance flags. |
| groundPenetrationPx | <= 0.5 px | Lowest foot point below y = 0 at 48px scale, worst frame. |
| reachViolations | 0 | Frames where an IK target was farther than the leg's length and had to be clamped (a straight, locked leg reaching for the floor). |
| kneeLimitViolations | 0 | Knee flexion outside [0, 150] degrees, or the knee bending backwards (on the opposite side of the hip-ankle line from the body's front). |
| kneeSpeedDegPerSec | <= 600 | Peak knee flexion speed. Human walking peaks around 350-450 degrees/s; above 600 at 24 fps reads as a pop. |
| boneLengthError | <= 0.01 | Max relative change of thigh, shin, foot, upper-arm and forearm lengths from the rest pose. |
| rootSpeedError | <= 0.05 | During steady move segments, relative difference between the root's distance per second and the script speed. |
| alternationViolations | 0 | During steady walking, the same foot planting twice in a row. |
| skatingControlFails | >= 1 | The skating control (legs cycle with phase, feet are never planted in world space) fails footSlidePx. A gate set the control passes proves nothing. |
| nondeterministicFrames | 0 | Joint positions hashed per frame match a child-process re-run. |

## Judge panel (after the gates pass)

Ground-truth questions only, using stills from the runner:
1. Planted vs skating A/B, both orders: side-view onion skin of the legs in world space over one second of steady
   walking (ground line drawn; planted feet stay put, skating feet smear) -> "which character's feet grip the
   ground?". Truth: ours.
2. Pixel-art strip A/B, both orders: 8 consecutive P1-rendered 48px side-view frames of our walk vs the skating
   control -> "which is a believable walk cycle?". Truth: ours.
3. Direction of travel from a top-down footprint trace, plus a mirrored copy -> "which way is the character walking:
   up, down, left or right?". Truth from the scenario.
4. Turn: top-down footprint trace of walk-turn-stop, plus a mirrored copy -> "does the path turn left or right?".
   Truth from the scenario.
Pass: majority correct on each question; the skating control never preferred by a majority.

---

## Batch A: rig, pose and IK

### Task A1: Rig format (`src/formats/rig.ts`)

```ts
export type Leg = { side: 'left' | 'right', hip: string, knee: string, ankle: string, toe: string }
export type Arm = { side: 'left' | 'right', shoulder: string, elbow: string, wrist: string, hand: string }
export type Gait = {
  strideLength: number      // metres per full cycle (two steps) at reference speed
  referenceSpeed: number    // m/s at which strideLength applies
  stanceFraction: number    // 0.5..0.8, fraction of a cycle a foot is planted
  stepHeight: number        // metres, peak swing-foot lift
  bobAmplitude: number      // metres, pelvis vertical bob
  armSwingDegrees: number   // peak arm swing about the shoulder
  footSpacing: number       // metres, lateral distance between foot plants
}
export type Rig = { legs: Leg[], arms: Arm[], pelvis: string, upperBody: string[], gait: Gait }
```

`upperBody` lists every joint that moves rigidly with the pelvis (chest, head, visor, shoulders, cape anchors and
so on). Validation in the P1 pattern, plus `checkRig(rig, mannequin)`: every joint exists, each joint is used by
exactly one of legs, arms, pelvis or upperBody (otherwise it would silently stay at rest), two legs (left and right),
and ranges for the gait values. Stride length can vary with speed: `stride(speed) = strideLength * sqrt(speed /
referenceSpeed)`, clamped to [0.5, 1.5] x strideLength, so faster walking takes longer and quicker steps.

### Task A2: Pose and two-bone IK (`src/motion/pose.ts`, `src/motion/ik.ts`)

```ts
export type Pose = Record<string, Vec3>                // body-local joint positions
export function restPose (m: Mannequin): Pose
export function posedMannequin (m: Mannequin, pose: Pose): Mannequin  // same parts, joints replaced
export function twoBoneIk (options: { hip: Vec3, target: Vec3, upper: number, lower: number, pole: Vec3 }):
  { knee: Vec3, end: Vec3, clamped: boolean }
export function kneeFlexionDegrees (hip: Vec3, knee: Vec3, ankle: Vec3): number  // 0 = straight
export function kneeBendsBackward (hip: Vec3, knee: Vec3, ankle: Vec3, forward: Vec3): boolean
```

`twoBoneIk`: if the target is farther than `upper + lower - 1e-6`, place it at that distance along the same
direction and report `clamped`. If it is closer than `|upper - lower| + 1e-6`, push it out the same way. The knee lies
in the plane spanned by the hip-target line and `pole`, on the pole side, found with the law of cosines. Tests:
upper and lower lengths are preserved exactly (1e-9) for reachable targets; the knee lies on the pole side; an
unreachable target is clamped and flagged; a straight leg gives flexion 0; a right angle gives 90; backward bending
is detected.

Commit after each task. Review batch A, then continue.

## Batch B: gait planner

### Task B1: Footstep planner (`src/motion/gait.ts`)

```ts
export type FootState = { side: 'left' | 'right', ankle: Vec3, toeYaw: number, planted: boolean, lift: number }
export type GaitFrame = { root: RootState, pelvisOffset: Vec3, feet: FootState[], armSwing: number, phase: number }
export function planGait (options: { track: (t: number) => RootState, rig: Rig, rest: Pose,
  duration: number, fps: number }): GaitFrame[]
```

Algorithm:
- Phase advances by `distance travelled this frame / stride(currentSpeed)`; for turning in place, add
  `|yaw change| * turnPhaseRate` (a constant such as one full cycle per 90 degrees) so feet step around while
  pivoting. When the root is at rest and no foot is mid-swing, the phase stops.
- Each foot has a phase offset (left 0, right 0.5). A foot is in stance while its local phase is in
  `[0, stanceFraction)` and in swing otherwise.
- At lift-off, record the start position. The landing target is the predicted ankle position under the hip at the
  landing time, projected to the ground: take the root state at the predicted landing time (current time plus the
  remaining swing duration at the current speed), offset sideways by `footSpacing / 2` along the body's local X
  rotated by the landing yaw, and forward by `stride / 4`. Interpolate the swing from start to target with
  smoothstep horizontally and `stepHeight * sin(pi * s)` vertically. The foot's yaw blends to the landing yaw.
- While planted, the ankle position and yaw are frozen in world space.
- Stopping: when the root speed falls to 0, the swing foot completes its swing to a target beside the other foot
  (offset by `footSpacing` sideways, no forward offset), then both feet are planted and the phase stops.
- Pelvis: vertical bob `-bobAmplitude * cos(4 pi phase)` while moving (two dips per cycle, lowest at double
  support), easing to zero at rest; and a pelvis drop large enough that the farthest stance foot stays reachable
  (compute the needed drop from the hip-to-ankle distances and take the larger of bob and drop).
- Arms: `armSwing = armSwingDegrees * sin(2 pi phase)`, opposite in sign for left and right, scaled by
  speed / referenceSpeed (clamped to 1) and easing to 0 at rest.

Tests (synthetic rig and straight-line tracks): walking at constant speed plants feet alternately with spacing
`stride / 2` along the path; planted feet don't move in world space; in-place turning produces steps; after a stop,
both feet are planted side by side and nothing moves; the phase at 0.6 m/s advances at half the rate per second of
the phase at 1.2 m/s times the stride ratio; determinism.

### Task B2: Pose from gait (`src/motion/locomotion.ts`)

```ts
export function poseAt (options: { frame: GaitFrame, rig: Rig, rest: Pose, mannequin: Mannequin }):
  { pose: Pose, clamped: number }
```

- Upper body and pelvis: rest positions plus `pelvisOffset`.
- Legs: hip from the upper body (hips move with the pelvis), the ankle target converted from world to body-local,
  `twoBoneIk` with the pole along the body's forward (+Z local) so knees bend forward. The toe is placed from the
  ankle with the rest ankle-to-toe vector rotated by the foot's yaw relative to the body yaw; during swing, pitch
  the toe up by up to 20 degrees with `lift`.
- Arms: rotate elbow, wrist and hand about the shoulder around the local X axis by `armSwing`.
- `clamped` counts IK targets that had to be clamped (feeds the reachViolations gate).
Tests: bone lengths of legs and arms equal rest lengths within 1e-9; with the root at rest and feet at rest
positions, the pose equals the rest pose within 1e-6; knees bend forward.

Commit after each task. Review batch B, then continue.

## Batch C: metrics, stills and runner

### Task C1: Locomotion metrics (`src/motion/metrics.ts`)

A recording stores per frame: time, root state, world-space joint positions, the clamp count, and the planner's
planted flags (kept for diagnostics only; gates use geometry). Metrics, each a pure function of the recording, one
per gate in the table (footSlidePx and groundPenetrationPx take the metres-per-pixel scale), plus `frameHashes`.
Each with synthetic tests whose answers are known (for example, a foot that sits on the ground and moves 1 cm per
frame gives the expected slide).

### Task C2: Skating control (`src/motion/skating.ts`)

Same rig, track and pose code, but feet are placed relative to the root every frame: the ankle follows a cyclic
offset (forward/back by `stride / 4 * sin(2 pi phase)`, lifted during the back half) under the hip, so the legs move
and the feet slide. Test: the control's footSlidePx exceeds 1 px/frame on a steady walk.

### Task C3: Stills (`src/diagnostics/locomotion-images.ts`)

- `footprintTrace`: top-down, root path and every planted-foot position (left and right in two colours).
- `legOnionSkin`: side view in world space over a time window, with a ground line, legs drawn as lines
  (hip-knee-ankle-toe), older frames lighter.
- `pixelStrip`: N consecutive frames rendered with the P1 pipeline (`fitCamera`, `rasterize`, `stylize`) from a
  given direction at 48px, using a fixed camera position (the root's horizontal position at the strip's middle
  frame) so the character visibly moves across the strip; frames laid side by side.
Tests: sizes, ground line present, planted footprints counted.

### Task C4: P4 assets, gates and runner (`pocs/p4-locomotion/`)

- `knight.json`: copy of the P3 knight (cape and plume parts excluded from rendering are fine to keep; they move
  with the upper body).
- `rig.json`: legs from the knight's hip, knee, ankle and toe joints; arms from shoulder, elbow, wrist and hand;
  pelvis and upper body covering every other joint. Starting gait: strideLength 1.3 at referenceSpeed 1.2,
  stanceFraction 0.62, stepHeight 0.08, bobAmplitude 0.025, armSwingDegrees 20, footSpacing 0.26.
- The three scenarios as P3 script files (`walk-turn-stop.json`, `slow-fast.json`, `pivot.json`).
- `gates.ts`, `run.ts`: the P3 runner's structure and exit-code contract. Per scenario: plan, pose, record, compute
  metrics; run the skating control for walk-turn-stop; write `reports/p4/` with `metrics.json`, `summary.txt`, the
  footprint traces, leg onion skins (ours and control), pixel strips (ours and control, side view) and an 8-direction
  contact sheet of one mid-stride frame; determinism via a child process.

Review batch C, then run the judge panel (controller) and log findings in `docs/plans/p4-findings.md`.

## Amendment after batch B (before batch C)

- Foot points for `footSlidePx` and `groundPenetrationPx` are measured at the sole: the ankle and toe joints
  lowered by the radius of the foot part that spans them (`radiusA` at the ankle, `radiusB` at the toe, from the
  mannequin). Measured at the joints, the knight's feet are never within 2 cm of the ground (its toe joint sits at
  6 cm, at the centre of the foot capsule), so the slide gate would pass without measuring anything. The runner must
  also report how many frames each foot counted as planted; a planted-frame count of zero is a harness error
  (exit 2), not a pass.
- Starting gait in Task C4: `strideLength` 1.0 instead of 1.3. At 1.3 the knight's short, straight legs need a
  0.39 m pelvis drop and the knee peaks at 645 degrees/s (gate 600); at 1.0 it measured 556 degrees/s. This is a rig
  parameter, not a gate.
