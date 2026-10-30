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
| `unbalancedFrames` | 0 for characters with 3+ legs: frames where the centre of the body (pelvis-group centroid projected on the ground) lies outside the convex hull of the planted feet by more than 2 cm | new locomotion gate |
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
- `bend` takes a single value or an array with one entry per intermediate joint (`joints.length - 2`).
- Template phases are side-aware (position among legs of the same side), so leg order in the file does not matter.
- Appendage oscillators take `period` in seconds, required when `degrees > 0`.
- Arms may have any number of joints (2 or more); swing rotates the whole chain about the first joint.
