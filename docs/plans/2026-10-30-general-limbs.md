# General Limbs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan in batches.

**Goal:** remove the fixed body plan. A rig describes any number of limbs of any shape: legs (ground contact, gait,
IK) with any number of segments, arms, and appendages (tails, ears, antennae, wings) with secondary motion. Templates
(biped, quadruped, hexapod, octopod) are presets that fill in defaults, never limits, and a starter command writes a
package that passes `check`.

**Constraint:** every existing package and runner output stays byte-identical in pixels (P1, P3, P4, P6, `check` on
every example). Existing `legs`/`arms` rigs are translated into the new model, not rewritten.

## Model

```json
{
  "template": "quadruped",
  "pelvis": "pelvis",
  "upperBody": ["chest", "head", "..."],
  "limbs": [
    { "name": "legLF", "kind": "leg", "joints": ["hipLF", "kneeLF", "hockLF", "toeLF"],
      "side": "left", "phase": 0.25, "bend": "backward", "limits": { "min": 0, "max": 150 } },
    { "name": "armR", "kind": "arm", "joints": ["shoulderR", "elbowR", "wristR", "handR"], "carried": ["swordTip"] },
    { "name": "tail", "kind": "appendage", "joints": ["tail1", "tail2", "tail3", "tailTip"],
      "stiffness": 0.6, "damping": 0.4, "oscillate": { "axis": [1, 0, 0], "degrees": 0, "phase": 0 } }
  ],
  "gait": { "strideLength": 0.4, "...": "as today" }
}
```

- `leg`: joints from the hip to the toe, 3 or more joints. The last two joints form the foot (the foot capsule rule
  applies to them). The gait plans the foot (ankle = second-to-last joint, toe = last); IK places the chain.
  `phase`, `bend` (the side every intermediate joint bends to, or per-joint `bends` array), optional joint limits.
- `arm`: joints from the shoulder, 2 or more; swings in counter-phase to the nearest leg on the same side (as today
  for bipeds; zero swing if the template says so); `carried` joints move rigidly with the last segment.
- `appendage`: joints from the root outward, 2 or more. Rigid segments driven by the body with a damped angular spring
  toward the rest direction (relative to the parent segment), plus an optional sinusoidal oscillator (for wings, tail
  wags). Deterministic, integrated at the cloth substep rate.
- `legs` and `arms` (current format) remain valid and are translated to `limbs` on load.

## Templates

`biped`, `quadruped`, `hexapod`, `octopod`. A template provides: leg phases by leg order (biped alternating;
quadruped walk LH 0, LF 0.25, RH 0.5, RF 0.75; hexapod tripod 0 / 0.5 alternating sets; octopod alternating
tetrapod), stance fraction, starting gait values scaled by leg length, default bends, and arm swing. Explicit
fields always override. `pinata new --template <name> <dir>` writes a minimal starter package (mannequin skeleton,
rig, style, materials, motion) that passes `check`.

## Gates (fixed before implementation)

| Gate | Threshold | Where |
|---|---|---|
| Existing outputs identical | pixels identical for P1, P3, P4, P6 and `check` on every example | regression |
| Starter packages pass `check` | all four templates | new test per template |
| New examples pass `check` | `examples/beetle` (hexapod, 3-segment legs), `examples/spider` (octopod), `examples/horse` (quadruped, 3-segment digitigrade legs, tail and ears as appendages) | examples |
| N-segment IK | segment lengths preserved within 1e-9; end reaches reachable targets within 1e-4 m; joint limits respected | unit tests |
| `unbalancedFrames` | 0 for characters with more than four legs (was 3+; see "Decisions during batch C"): frames where the centre of the body (pelvis-group centroid projected on the ground) lies outside the convex hull of the planted feet by more than 2 cm | new locomotion gate |
| `appendageBoneLengthError` | <= 0.01 | new gate |
| `appendageNonFinite` | 0 | new gate |
| Existing locomotion gates | pass on every new example (slide, knee speed generalised to every bending joint, ground, reach, alternation in phase order, support) | examples |

## Batches

- **A. Format and templates:** limb model, validation with actionable messages, translation from `legs`/`arms`,
  template expansion, tests. Review.
- **B. Kinematics:** N-segment IK (two-bone analytic kept for 3-joint chains so existing output is identical;
  FABRIK with a pole and joint limits for longer chains); gait and pose generalised to limbs; arms per side;
  appendages placed at rest (dynamics in C). Review.
- **C. Dynamics and gates:** appendage spring and oscillator; balance metric and gate; appendage gates; every metric
  and hint per limb; knee speed per bending joint. Review.
- **D. Starter command, examples, guide:** `pinata new`, the three new examples, [`docs/authoring.md`](../authoring.md) updated (templates,
  limbs, appendages). Final review, then a lineup render.

## Decisions after batch A

- A leg has at least 4 joints: hip, at least one intermediate joint, ankle, toe (at least two bones before the foot).
  4 joints is the classic two-bone leg and keeps the exact analytic IK; 5 or more use FABRIK.
- `bend` takes a single value or an array with one entry per bending joint, the joints strictly between the hip and
  the ankle (`joints.length - 3`; corrected after the batch A/B review, which found `joints.length - 2` counted the
  ankle, which does not bend). `bend` may also be `up` (for splayed legs such as a spider's, whose knees rise above the
  hip).
- Template phases are side-aware (position among legs of the same side), so leg order in the file does not matter.
- Appendage oscillators take `period` in seconds, required when `degrees > 0`.
- Arms may have any number of joints (2 or more); swing rotates the whole chain about the first joint.

## Decisions after the batch A/B review

- Template defaults (phases, bends) are resolved after the mannequin loads, ordering each side's legs front to back by
  rest hip position, so file order never matters.
- Leg labels: `left`/`right` for two legs, `left front`/`left hind` for two per side, and `left 1` .. `left n` (front
  to back) for three or more per side; the limb `name` is shown alongside.
- Lateral foot placement: a leg plants at its rest ankle's sideways offset when the rig says so (default for hexapod
  and octopod templates); bipeds and quadruped files keep `footSpacing / 2`, so existing output is unchanged.
- IK reports the miss distance; any miss above 1e-4 m counts as a reach violation. Joint limits apply to two-bone legs
  too when given.

## Decisions during batch C

- Appendage spring: each segment tip is integrated in world space with an implicit spring-damper toward its target
  (the rest direction relative to the parent segment; the first segment's parent is the body), then projected back to
  its bone length, so bone lengths hold exactly. Natural frequency 0.3 Hz at stiffness 0 up to 3 Hz just below 1;
  stiffness 1 is rigid. `damping` is the damping ratio (1 = critical). No gravity. The root joint, pelvis offset and
  yaw are interpolated linearly between frames; `check` and the cloth run use the scenario's `substeps`, other
  recordings 8. The oscillator rotates the first segment's rest direction about `axis` (body space) by
  `degrees * sin(2 pi (t / period + phase))`; later segments follow relative to it.
- Each segment carries a rotation from rest to its current direction: its target rotation (the parent's rotation;
  for the first segment the body yaw after the oscillator) followed by the smallest swing to where the spring put
  it. Children aim through it, so a wag about any axis turns the whole chain (the batch C review found that building
  child targets from directions alone lost the oscillator's twist and flipped near 180 degrees). Known limit: a very
  soft appendage on a very fast spin (a half turn in a quarter second) still trails nearly 180 degrees behind, where
  the swing is ill-defined, and flails; a half turn in a second at stiffness 0.2 stays smooth. A 120-degree swing
  cap was tried and made it worse (the tail snapped along with the target).
- The appendage gates cannot fail for a rig that passes validation (checkRig rejects shared and coincident joints,
  and the implicit spring is stable at any step), so their hints say so and ask for a report instead of giving
  advice.
- Balance gate changed before it was ever applied: the plan said 3+ legs, but the `examples/dog` walk (stance 0.75)
  has the body centre up to 5 cm outside the support triangle in 25 frames even with a volume-weighted centre (88 mm
  and 107 frames with a plain joint mean, which the head and ears pull forward). A four-legged walk balances
  dynamically, so `unbalancedFrames` is gated for **more than four legs** only; bipeds and quadrupeds show no line.
  Needs the user's confirmation.
- Body centre: volume-weighted centroid of the parts whose joints are all pelvis or upperBody joints (each part at its
  midpoint), falling back to the mean of those joints when no part qualifies. Support: the convex hull of sole points
  within 2 cm of the ground in that frame; frames without support are left to `unsupportedFrames`.
- The hexapod fixture's tripod at stanceFraction 0.6 passes, but its worst frame puts the centre on the hull edge
  (0 m, the 2 cm tolerance unused; its chest sits forward of the middle legs); at 0.7 it stays more than 2 cm inside,
  at 0.5 it is 1.2 cm outside. Starter hexapods should use a centred body or stanceFraction 0.65 or more.
- The batch C reviewer agreed with the more-than-four-legs rule and suggested, if quadrupeds should be covered, gating
  them only at stanceFraction 0.75 or more (the statically stable walk); not done, since the dog example (0.75)
  fails it.
- `lateral: 'rest'` now plants each walking foot at its rest ankle's offset along the body as well as sideways
  (batch D: the spider's fanned legs bunched under the body because feet planted level with their hips). Stopping
  still places a foot beside its partner. Only `rest` rigs change; no earlier example uses it.
- Arms are labelled `left arm` for one per side and `left arm 1` .. `n` front to back for several.
