# Physical Walking: Bodies With Weight

**Goal:** walking characters move like the hanging piñata does: as physical bodies with mass and momentum, pushed
toward where they want to go and held up by their legs, instead of following a scripted root track with footsteps on
a fixed rhythm. Legs step when the body needs catching. Motion becomes natural and adaptive: wind pushes bodies, a
quake or a poke shoves them, slopes slow them, and each body's mass and leg count give it its own feel.

**Why (user, 2026-10-30):** the world's walkers look robotic. Every part is correct (planted feet, IK, terrain), but
the body slides along a precomputed track, turns in place on a script, and steps on a metronome, so nothing has
weight. Lean, squash and head lag added on top are decorations, not causes. The piñata looks natural because it is
physics. Procedural creatures that feel alive (Rain World, Overgrowth, procedural spider robots) use the same idea:
a physical body, and legs that serve it.

**Status (2026-10-30):** for humanoids this is now the physical layer under motion-capture playback
([motion data plan](2026-10-30-motion-data.md)); bodies without real-world data keep the procedural stepping here.
A first draft is in `src/motion/walker.ts` (on flat ground the feet overreach and the body does not bob yet).

**What stays:** the IK (two-bone and FABRIK with poles and limits), terrain support (plants on the surface under the
whole foot, tread nudges, swing clearance), spring chains, cloth, the joint hierarchy, `poseAt` (a physical frame
produces the same `GaitFrame` the planner did), every renderer, and the offline planner, which keeps all existing
outputs byte-identical.

## Model

- **Body:** a rigid body per character with mass (from its parts' volumes), position, velocity, yaw and yaw rate,
  and a torso tilt (pitch and roll) with its own inertia. Forces: gravity; support from planted legs (a spring-damper
  per planted leg toward the rest ride height, only within the leg's reach); traction toward a desired velocity,
  limited by how many feet are planted and by a maximum acceleration; wind drag on its side area; impulses from
  events. Steering is a torque toward a desired heading. Tilt follows the forces (it pitches into acceleration and
  against the wind) and a restoring spring brings it back. Fixed substeps, deterministic.
- **Stepping:** each foot has a target: under its hip, plus half the stance's travel at the current velocity (the
  Raibert rule), at its rest sideways offset, supported on the terrain. A foot lifts when it is too far from its
  target or its leg is near the end of its reach, as long as its neighbours (the template's gait groups: alternate
  legs for two, diagonal pairs or the walk sequence for four, tripods for six, tetrapods for eight) are planted. A
  swing lasts a time that shortens with speed, follows the existing arc and clearance, and lands on its target
  re-evaluated during the swing. A body that stops gathers its feet back under it.
- **Control:** activities set goals, not moves: a desired velocity toward a point (slowing on arrival), a heading,
  or standing still. Paths curve naturally because heading and velocity have dynamics. A poke is an impulse plus the
  startle reaction; a quake is a ground acceleration on every planted foot.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical | the offline planner is untouched |
| Locomotion quality | foot slide <= 0.25 px, sole penetration <= 0.5 px, reach violations 0, knee limits 0, bone length error <= 0.01 | measured against the ground, on recordings of every example walking a generated course for 60 s |
| Stays upright | the body's height above the ground under it stays within 0.6 to 1.3 times its rest ride height, and no value is ever non-finite, over 10 simulated minutes per example on generated terrain with the showcase's activities | stability |
| Responsive | on flat ground, 90% of a commanded speed within 1.5 s, stopped (under 5% of it) within 1.5 s of a stop command, heading within 10 degrees within 1.5 s of a turn command | control |
| Adapts | walking into a 4 m/s headwind is at least 10% slower than in calm air, and a poke moves the body at least 0.1 m | weather and events matter |
| Natural | blind judge panel (the `judge` module: neutral names, both orders, a control): strips of the physical walk against the scripted walk for three characters, "which moves more naturally"; physical picked in at least two thirds of the non-control answers | readability |
| Determinism | identical frames in Node and Chrome for a seed and the same events | |
| Real-time | 8 characters on the showcase page: p95 frame time <= 40 ms in headless Chrome | budget |

## Batches

- **A. Body and stepping on flat ground** (Node): the rigid body, support, traction and steering, Raibert stepping
  with gait groups, for the biped and quadruped fixtures and the examples; the stability, responsiveness and quality
  gates on flat ground. Review.
- **B. Terrain, many legs and the upper body**: plants and swings on terrain through the existing support, hexapods
  and octopods, arms swinging from the stepping phase, torso tilt and head lag driven by the physics (replacing the
  decorative lean); quality gates on generated terrain. Review.
- **C. The world**: activities as goals, pokes and wind as forces, quakes as ground motion; the adaptation gate, the
  judge panel, determinism and the real-time gate in Chrome. Review, then release.
