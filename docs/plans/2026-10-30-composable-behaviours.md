# Composable Behaviours

**Goal:** complex animation is built from simple, separately checked pieces that an AI agent composes, instead of
every behaviour being written by hand. The same composition model drives offline renders (motion scripts) and the
live runtime (P8, [`docs/plans/2026-10-30-runtime-spike.md`](2026-10-30-runtime-spike.md)).

This follows standard animation practice: sequencing, layering with limb masks, additive overlays, blending,
state machines and procedural layers. Piñata's difference is that most pieces are procedural (physics, IK,
constraints) rather than hand-made clips, and that each piece and each composition has machine-checkable gates.

## Concepts

| Concept | Meaning | Example |
|---|---|---|
| Base motion | Drives the root and the body as a whole. Exactly one is active (or two while blending). | `stand`, `walk`, `run`, `hang`, `sit`, `jump` |
| Layer | Drives the limbs named in its mask, overriding the base motion for those limbs. | `wave` on an arm, `lookAt` on the head, `wag` on a tail, `carry` on arms |
| Additive overlay | Adds a small offset on top of everything else, on any limbs or the body. | `breathe`, `bob`, `shiver`, `slump`, `bounce` |
| Event | A one-off input turned into a physics response or a short overlay. | `hit({ impulse, spin, at })`, `land`, `stumble`, `startle` |
| Blend | Cross-fade between two base motions, or a layer fading in and out, over a set time. | `walk` to `stand` over 0.3 s |
| State machine | Named states, each a composition, with transitions on events or conditions (runtime). | `idle` to `busy` on "agent started a tool call" |

## Format

A behaviour is a JSON composition. Behaviours live in a character package's `behaviours.json` (or a shared library
file) and are referenced by name from motion scripts and from the runtime.

```json
{
  "behaviours": {
    "idle":      { "base": "hang", "additive": ["breathe"] },
    "think":     { "base": "hang", "layers": [{ "do": "sway", "mask": ["body"], "period": 3 }],
                   "additive": ["breathe"] },
    "busy":      { "base": "hang", "additive": [{ "do": "bounce", "amplitude": 0.03, "period": 0.6 }] },
    "celebrate": { "base": "hang", "layers": [{ "do": "spin", "mask": ["body"], "turns": 1, "duration": 1.2 }],
                   "additive": ["bounce"], "then": "idle" },
    "fail":      { "base": "hang", "events": [{ "at": 0, "do": "hit", "impulse": [1.4, 0, 0.3], "spin": 2.5 }],
                   "then": "idle" }
  },
  "states": {
    "initial": "idle",
    "transitions": [
      { "on": "toolStart", "to": "busy", "blend": 0.3 },
      { "on": "thinking", "to": "think", "blend": 0.5 },
      { "on": "success", "to": "celebrate", "blend": 0.1 },
      { "on": "failure", "to": "fail", "blend": 0 }
    ]
  }
}
```

Motion scripts gain a segment that plays a behaviour for a duration (`{ "action": "behave", "name": "wave",
"duration": 2 }`) and can run layers in parallel with `move`/`turn` segments.

Masks are sets of joints in the point hierarchy (a joint name covers its whole subtree; limb names and `body` are
shorthands), per [`docs/plans/2026-10-30-image-points.md`](2026-10-30-image-points.md), "Decisions during batch A".

## Evaluation order (per frame)

1. Base motion (blended if two are active): root, body orientation and the default pose of every limb.
2. Layers, in listed order: each writes only the limbs in its mask, blended by its weight.
3. Constraints: foot IK, look-at, carried props.
4. Additive overlays: summed offsets, scaled by their weights.
5. Events due this frame: impulses and spins applied to the body's physics.
6. Secondary motion: cloth and appendages step on the final body pose.
7. Render.

Physics state (body swing, cloth, appendage springs) carries across behaviour switches; only targets and weights
blend, so a switch never resets the simulation.

## Primitive library v1

- **Base:** `stand`, `walk`, `hang` (rope or spring from an anchor; needs full 3D body orientation, see the roadmap's
  rigid-body behaviours).
- **Layers:** `wave`, `lookAt`, `sway`, `spin`, `wag`, `carry`.
- **Additive:** `breathe`, `bob`, `bounce`, `shiver`, `slump`.
- **Events:** `hit`, `startle`.
Each primitive has parameters with ranges, validated like every other format, and its own unit test.

## Gates

| Gate | Threshold |
|---|---|
| Composition validates | unknown primitives, unknown limbs in masks, out-of-range parameters and unreachable states are load errors with actionable messages |
| Mask ownership | a layer never changes a joint outside its mask (checked per frame) |
| Additive bounds | an overlay's offset stays within its declared amplitude |
| Transition smoothness | at every behaviour switch, the frame-to-frame joint movement stays below 3 times the median movement of the surrounding second, for a zero-blend switch except on event frames |
| Physics continuity | no reset of body, cloth or appendage state at a switch (positions continuous across the switch frame) |
| Existing gates | locomotion, cloth and static gates still apply to every frame of a composed behaviour |
| Determinism | the same event sequence gives identical frames |
| Agent authoring | a fresh agent, given the behaviour section of the authoring guide, writes a new behaviour (for example "nervous: fidget and glance around") that passes every gate within 5 check runs |

## Phasing

1. **With the runtime spike (P8):** the composition evaluator, `hang` as the base, `sway`, `spin`, `bounce`,
   `breathe` and `hit`, blending and the state machine. The spike's five behaviours are written as compositions in a
   `behaviours.json`, not hard-coded.
2. **After the spike:** `stand` and `walk` as bases (needs the online gait planner the spike motivates), the remaining
   layers and overlays, script integration, `check` support (gates above), and the authoring guide section with the
   agent authoring test.
