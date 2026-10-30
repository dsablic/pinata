# Piñata: Viability Design

Date: 2026-10-30
Status: approved for proof-of-concept phase

## Goal

A headless, AI-driven tool that turns a character description and a behaviour
script into pixel-art animation. Motion comes from kinematics and physics;
visual style is a separate, swappable layer. No editor; AI is the primary
author. Interop with animator tools happens through export.

This document defines the requirements, the components, and the isolated
proofs of concept (PoCs) that decide whether the whole is viable.

## Prior art (checked 2026-10-30)

- Rigby2D (MIT/Apache, MCP, IK, physics constraints): 2D mesh rigs, no pixel style layer.
- Sprite Studio (open source, MCP): rig points + deterministic pixel renderer, no physics.
- Keyframe.it (free, not open source, MCP): rigging, IK, springs, pixelizer.
- PixelLab, Pixel Engine, PIXL, pixel-mcp: generation or frame editing, no rig or physics.
- Dead Cells: 3D-to-pixel rendering pipeline, proven in a shipped game.

The pieces exist; the combination (motion/style separation, physics from
intent, pixel-grid stability, agent-first formats) does not.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Views | 3D mannequin, side + top-down + 3/4, 4 or 8 directions | Turns and inertia are 3D; one character serves all views |
| Size bar | 32-64px tall | Covers most indie pixel art; hard enough to be meaningful |
| Character input | Text only; image input later | Image-to-mannequin is a separate research problem |
| Quality judgment | Metric gates + a blind AI judge panel for the checklists; one human pixel artist only at the end-to-end gate | Neither the user nor Claude is a pixel art expert, and the user has no time for manual review |
| PoC stack | TypeScript (Node), custom CPU rasterizer, own or Rapier physics | Iteration speed; tiny frames make performance irrelevant; production stack decided after PoCs |

## Requirements

- **R1 Mannequin:** 3D skeleton, volumes per bone (capsules/ellipsoids), soft parts (capes, hair, tails as chains), material ID per part, anchors (eyes, held items).
- **R2 Materials:** physical parameters (stiffness, damping, mass, drag) and render hints (colour ramp, shading).
- **R3 Environment:** gravity, wind (direction, strength, gusts), medium drag.
- **R4 Behaviour script:** action sequence (walk, turn, stop, idle, jump, crouch) compiled to root motion, IK targets and contacts.
- **R5 Secondary motion:** soft parts respond to inertia and environment, no body penetration.
- **R6 Style:** renders 32-64px frames for any view and direction: palette, outline, shading, decals at anchors.
- **R7 Pixel stability:** no visible crawl or flicker on slow motion; readable silhouette.
- **R8 Diagnostics:** numeric metrics; still images that show motion (upscaled contact sheets, frame-difference maps, onion skins, trajectory traces, value-over-time plots, debug passes); a looping preview page for humans.
- **R9 Determinism:** same inputs, byte-identical outputs; all inputs are diffable text.
- **R10 Export:** sprite sheet + JSON, Aseprite. Spine/Rigby later.

Non-goals for this phase: editor GUI, image input, real-time playback,
Rust/Odin port, two-way sync, sizes outside 32-64px.

## Components

| | Component | Responsibility |
|---|---|---|
| C1 | formats | Text schemas for mannequin, material, environment, style, behaviour; validation with actionable errors |
| C2 | kinematics | Skeleton posing with joint limits; two-bone analytic IK for limbs, FABRIK for spine and neck |
| C3 | planner | Behaviour script to root trajectory, footsteps, IK targets, timing (holds, anticipation) |
| C4 | sim | Particle/constraint chains and cloth strips, capsule collision, materials and environment, driven by the kinematic body |
| C5 | raster | Volumes to low-res per-pixel buffers (depth, part ID, material, normal) per view and direction |
| C6 | style | Buffers to pixel art: palette, outline, shading bands, decals, crawl suppression |
| C7 | diagnostics | Metrics, motion-as-stills images, preview page |
| C8 | cli | Agent interface; MCP server wraps it later |
| C9 | export | Sprite sheet + JSON, Aseprite |

## Proofs of concept

Ordered by risk. Each runs in isolation with other components stubbed.
Dependencies: P1, P3, P4 are independent; P2 needs P1; P5 needs C1, P1, P3;
P6 needs P1, P2.

Thresholds are initial values, calibrated during P1 and locked before each
PoC starts. Each locked threshold records its rationale.

### P1 Static style (highest risk)

Hand-written mannequin, standing pose, 8 directions, 32px and 48px.

- Metrics: outline fully closed; body parts at least 2px thick at 32px; at most 16 colours per character, identical across directions; fewer than 3 stray single pixels per frame.
- A/B checklist: which way does it face (all 8 identifiable); can you point to head, torso, arms, legs, cape; which looks more hand-made, ours or the reference sprite (target: "can't tell" or close).
- Fallback: passes at 48px only, raise the bar to 48px; fails both, try per-part skins before declaring the concept dead.

### P2 Pixel stability

Same mannequin, slow turn and arm swing.

- Metrics: at 1 degree per frame, pixels flipping A-B-A within 3 frames under 1% of silhouette; no part area jump over 15% between frames without motion cause; zero outline breaks.
- A/B checklist: does anything shimmer; does stepping look deliberate or glitchy.

### P3 Secondary motion

Capsule body, scripted turn and stop, cape and hair in 2-3 materials, wind. Debug renders only.

- Metrics: 1000 frames without blow-up, bounded energy; cape-body penetration under 0.5px on screen in under 1% of frames; settle time after stop within the expected range per material; identical output hash across runs.
- A/B checklist: does the turn show lag, overshoot, settle; can you tell materials apart by motion alone; can you tell where the wind blows.

### P4 Planner and IK

Walk, turn, stop, idle from a behaviour script, multiple directions.

- Metrics: planted foot slide under 0.25px per frame at 48px; zero joint-limit violations; no knee angular-velocity spikes above threshold; root speed within 5% of script.
- A/B checklist: does it read as walking in every direction; does the turn shift weight; does the stop settle.

### P5 AI authoring loop

An agent, with no human edits, writes a new character, materials and script from a text prompt and iterates on diagnostics.

- Metrics: for 3 distinct prompts, all automated gates pass within 10 runs; format errors fixed within 2 attempts.
- A/B checklist: does the result match the prompt.

### P6 Style swap

Same character and animation, 2-3 styles.

- Metrics: motion data byte-identical across styles; each style passes P1 and P2 metrics.
- A/B checklist: are the styles clearly different; is it clearly the same character.

### End-to-end viability

Full pipeline. Blind review: the AI judge panel, plus one human pixel artist if one can be found, rates 4 of our animations and 4
hand-made CC0 references (mixed, unlabelled) on a 1-5 scale. Pass if our mean
is within 0.75 of the reference mean.

## Iteration loop

1. Numeric diagnostics drive most fixes.
2. Claude reviews still images: 8x nearest-neighbour contact sheets, frame-difference maps (crawl shows as noise, motion as coherent edges), onion skins, trajectory traces, value plots, debug passes.
3. Checklist questions go to the AI judge panel (below). The looping preview page stays for anyone who wants to look.

## AI judge panel

Replaces human checklist review wherever a judge can plausibly answer.

- Three independent judges, each a fresh agent with no project context, seeing only neutrally named images.
- The answer key lives outside the judges' folder.
- Ground-truth items (such as facing direction) score the judges as well as the sprites.
- Every A/B pair appears in both left/right orders; a judge "detects" our render only if it picks consistently.
- Control pairs of two hand-made sprites measure each judge's bias; a judge that confidently picks sides on
  controls has its A/B answers discounted.
- Motion checklists (P2-P4) give judges motion-as-stills images (contact sheets, difference maps, traces), since
  judges cannot watch animation.
- Caveat: a model of the same family as the author is a proxy for a typical viewer, not an expert eye.

## PoC harness

- TypeScript monorepo; packages map to components (formats, kinematics, sim, raster, style, diagnostics, cli).
- Each PoC is a script under `pocs/pN-*` using only the packages it needs.
- One command per PoC writes a report folder: metrics JSON, still images, preview HTML, pass/fail summary against gates.
- Gates live in code with their thresholds and rationale.
- Golden-hash tests for determinism; unit tests for maths (IK, constraints, rasterization).
- Reference sprites in `refs/` with licence recorded.
