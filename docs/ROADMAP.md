# Piñata Roadmap

This roadmap turns the proof-of-concept results into a plan for building the tool. Every proof's plan, gates,
findings and judge artefacts are in `docs/plans/`.

## What the proofs showed

| Proof | Question | Verdict |
|---|---|---|
| P1 static style | Can a procedural renderer pass as hand-made pixel art at 32-64 px? | No: detected in 36 of 36 blind comparisons, before and after a targeted revision. Readable and consistent across 8 directions. |
| P2 pixel stability | Does the renderer stay stable in motion? | Yes, with temporal hysteresis: flicker under 1% on a slow turntable; an unsnapped camera control flickers 25-34%. One area-jump gate failed because it counted occlusion as instability. |
| P3 secondary motion | Does simulated cloth read as inertia, with materials and wind distinguishable by motion alone? | Yes: all gates pass, a rigid control fails them, judges ranked silk, wool and leather and read the wind correctly every time. |
| P4 locomotion | Does a behaviour script compile into planted, non-sliding footsteps with IK? | Yes for the motion (all gates, foot grip and turns read by judges 12 of 12). No for readability as 48 px procedural strips: judges could not tell it from a sliding control. |
| P5 AI authoring loop | Can a fresh AI agent author a character from a one-line prompt with only a guide and one command? | Yes: three characters passed every gate in 1, 4 and 6 runs with no format errors, and judges matched all three to their prompts. |
| P6 style swap | Is style independent of motion? | Yes: one character in three styles, motion byte-identical, judges grouped by character and by style without error. |
| Skins spike | Do AI-drawn per-part sprites driven by the rig look better than procedural rendering? | Promising: an AI artist produced a valid skin first try; judges preferred the skinned walk over the procedural one; on stills, 44 of 54 comparisons rated it more hand-made than CC0 references, but the panel's control rule failed, so formally inconclusive. |

**Conclusion.** The motion engine works: scripted locomotion, IK and physics-driven secondary motion, authored by AI
through text formats and a single check command with actionable hints. The procedural visual layer does not pass as
hand-made; per-part sprites ("skins") drawn by an AI artist are the most promising replacement. The tool to build is
an AI-native motion engine for 2D pixel characters, with skins as the visual layer and the procedural renderer kept
for previews, collision geometry and checks.

## Product definition

- **Users:** AI agents first (via MCP and a CLI), and the people directing them: indie developers and small studios
  who need many animated characters without an animator.
- **Inputs:** a character package (text files: body, rig, materials, motion, skin, style), written by an agent.
- **Outputs:** animated sprites for 4 or 8 directions (sprite sheets with JSON, Aseprite files), plus diagnostics.
- **Core promise:** the agent says what should happen ("walk, turn, stop; the cape is heavy wool; wind from the
  left"); the tool makes it physically right and tells the agent precisely what to fix when it is not.
- **Not in scope:** an editor GUI, 3D output, real-time game runtime (exports target existing runtimes).

## Phase 0: consolidate (about 1-2 weeks)

Turn proof-of-concept code into a coherent library. No new capabilities.

1. Merge the P1-P6 runners into one library of reusable pieces with a stable API; keep the proof runners as
   regression suites (each runner's gates become tests that must keep passing).
2. Render simulated cloth and chains into the pixel output. Today only parts are drawn, so every P5 author had to add
   a static stand-in part for the cape or scarf. This was the main product gap found.
3. Judge tooling in TypeScript: replace the shell and JavaScript packet scripts with a `judge` module (packet
   building with correct spacing, keys, scoring, controls), used by every future visual check.
4. Fix gate definitions the proofs found weak: area jumps that count occlusion (P2), speed windows that return
   Infinity with few plants (P4), the thin-part metric's non-monotonic behaviour, and the borderline knight values
   (thin fraction at 0.25, stray pixels at 2).
5. Performance: sequential rendering with hysteresis takes minutes for long sequences; profile before optimising.

Exit: all proof suites pass from the library; cloth is visible in rendered frames; one command per proof.

## Phase 1: minimum viable tool (about 4-6 weeks)

1. **Skins v1.** Per-part sprites for 4 and then 8 directions, with view buckets and pivots; rotation that keeps
   pixel art clean (pre-drawn angle variants for limbs, or a RotSprite-style algorithm instead of nearest-neighbour
   at 22.5 degree steps); skin validation and stills in `check`. An AI artist guide alongside `docs/authoring.md`.
   Proof gate before building it out: **P7** (below).
2. **Interfaces.** `pinata check`, `pinata render` and `pinata export` as a CLI, and an MCP server wrapping them, so
   agents in Claude Code and other clients use the tool directly.
3. **Export.** Sprite sheets with JSON frame data, Aseprite files; Spine/Rigby export later.
4. **Behaviour library.** Walk, run, idle, turn and pivot (proven), plus jump (ballistic root, landing IK), crouch
   and a simple attack, each with gates in the P4 style.
5. **Authoring hints.** Act on the P5 authors' notes: decals for small features, stride-to-leg-length guidance and
   diagnosis, palette budgeting, radius vs diameter wording, a reliable edit path for agents.

Exit: an agent, from a prompt, produces an 8-direction walking, idling and jumping character with a cape, skinned,
exported as a sprite sheet, and it passes every gate.

### P7 (next proof): multi-direction skins and quality

Before investing in skins v1, prove that an AI artist can draw skins for 8 directions (or 4 plus mirroring) that
stay consistent across views and survive walking, at 48 px and 32 px. Gates to fix before building it:
- Artist finishes a full directional skin set within a small budget of runs.
- Blind judges, using references of known high quality and both a detection and a 1-5 quality-rating question
  (the detection-only control rule broke down once the candidate was competitive), rate the skinned character at
  least as high as the references on average.
- A walk strip in every direction is preferred over the procedural renderer by a majority.
- One human pixel artist reviews the results (the only human check kept in the plan).

## Phase 2: depth (after the MVP)

- **Animation readability.** P4 showed a kinematically correct walk is not automatically readable at 48 px; skins
  helped, but animators also exaggerate contact and passing poses, hold key frames and draw smears. Add an
  exaggeration and timing layer on top of the physics, with judge-checked readability.
- **Environment.** Slopes and stairs (foot IK to terrain), wind fields and obstacles for cloth, water drag.
- **Body variety.** Non-humanoid rigs (quadrupeds, tails, wings) and props with constraints (two-handed weapons).
- **Import.** Bring in hand-made part sprites from Aseprite so human artists can supply skins directly.
- **Runtime exports.** Godot and Unity importers; Rigby2D/Spine interop.

## Risks and open questions

- **Visual quality is the main risk.** Skins are promising but proven only for one character, one view, against
  modest references. P7 decides whether the visual layer is AI-drawn skins or human-supplied art.
- **Judge reliability.** AI judges were reliable for ground-truth questions (materials, wind, facing in 3/4 view,
  prompt matching) and for detecting obviously procedural art, but unreliable for facing from a pure side view and
  once the candidate became competitive. Keep ground-truth questions, add quality ratings with strong references,
  and keep one human expert review before any public claim of quality.
- **Competition.** Rigby2D, Keyframe.it and Sprite Studio all gained MCP support in 2026. The differentiators
  (physics from intent, actionable diagnostics, style-independent motion) need to ship before they converge.
- **Small sizes.** 32 px is at the edge of what parts-based rendering can carry; many gates sit at their limits for
  the knight. Treat 48 px as the default and 32 px as a stretch target.

## Going public

Make the repository public when Phase 1 exits and P7 passes, with a README that states the results honestly, a demo
(an agent creating a character from a prompt, walking with a reacting cape, in several directions), the authoring
guide, and examples.
