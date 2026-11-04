# Piñata Roadmap

This roadmap turns the proof-of-concept results into a plan for building the tool. The results are summarised in
[`docs/FINDINGS.md`](FINDINGS.md). Open plans are in [`docs/plans/`](plans); finished ones, with every proof's gates,
findings and judge artefacts, in [`docs/plans/done/`](plans/done). [`docs/TODO.md`](TODO.md) says what is next.

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
  who need many animated characters without an animator, and web developers who want small reactive characters
  ("little computer people") in their UIs for comic relief or assistance.
- **Inputs:** a character package (text files: body, rig, materials, motion, skin, style), written by an agent.
- **Outputs:** two delivery targets from the same engine and character files:
  - game assets: animated sprites for 4 or 8 directions (sprite sheets with JSON, Aseprite files);
  - a live web runtime: a small JavaScript component that animates a character in real time and reacts to page or
    agent events (see P8).
  Both carry the same visual bar: characters must stand up to game art. Diagnostics come with both.
- **Core promise:** the agent says what should happen ("walk, turn, stop; the cape is heavy wool; wind from the
  left"); the tool makes it physically right and tells the agent precisely what to fix when it is not.
- **Not in scope:** an editor GUI, 3D output, and a full game-engine runtime (game exports target existing engines;
  the web runtime is for small UI characters, not games).

## Body plans and rigid-body behaviours (in progress)

- **General limbs** (done; [plan](plans/done/2026-10-30-general-limbs.md)): any number of legs with any segment count,
  arms, and appendages (tails, ears, antennae, wings) with spring and oscillator dynamics; biped, quadruped, hexapod and
  octopod templates; a starter command. Proportion guidance from the quadruped piñatas: keep the stride well under the
  front-to-back hip spacing (about 0.6x), or front and hind legs cross in 3/4 views.
- **Effects and weather:** a particle effects layer for the runtime component (emitters attached to joints or events:
  dust at footsteps, confetti on a hit, rain, snow, sparks), drawn in the active style and deterministic; weather and
  world events (wind, rain, earthquakes) that characters react to through behaviours. First in the world showcase
  ([plan](plans/2026-10-30-world-showcase.md), batch F).
- **Rigid-body behaviours:** a prototype hung the unicorn piñata from a rope, whacked it, and let it swing and twist
  with limp legs, mane and tail (simulated as cloth on the moving body). To make that a motion script like walking:
  a root with full 3D orientation (today it can only yaw), a `hang` behaviour (rope or spring from an anchor), scripted
  `hit` events (impulse and spin at a point), and limp limbs as low-stiffness appendages.

## Built since the proofs

- **The live runtime (P8)** ([spike](plans/done/2026-10-30-runtime-spike.md)): characters animate live in the browser
  (`<pinata-character>`, the hanging piñata, the Claude Code mod), with behaviours composed from simple primitives
  ([composable behaviours](plans/2026-10-30-composable-behaviours.md)).
- **The page as the world** ([plan](plans/2026-10-31-page-world.md)): characters live on an ordinary web page; marked
  elements are ground and walls; characters walk, step up, drop, jump and react to the page over a click-through
  overlay, and the front page is built on it.
- **Natural motion:** humanoids move by retargeted motion capture with motion matching and a light physical body
  ([motion data](plans/done/2026-10-30-motion-data.md)); capes, cloaks and robes are simulated cloth drawn in the
  skins; falls dip and absorb; jumps play capture take-offs and landings
  ([natural page motion](plans/done/2026-11-02-natural-page-motion.md),
  [jump takes](plans/done/2026-11-04-jump-takes.md)).
- **The visual bar is settled** where it is: after P7, a beat-and-pose stage, hand-drawn walk frames and a restyle
  each missed their gates against hand-drawn game sprites (see P7 below and [`TODO.md`](TODO.md)).

## Phase 0: consolidate (about 1-2 weeks)

Turn proof-of-concept code into a coherent library. No new capabilities.

1. Merge the P1-P6 runners into one library of reusable pieces with a stable API; keep the proof runners as
   regression suites (each runner's gates become tests that must keep passing).
2. ~~Render simulated cloth and chains into the pixel output.~~ Done: chains and capes with a `render` entry are drawn
   as thin capsule parts, in the demo and in the `check` contact sheet and walk strip.
3. ~~Judge tooling in TypeScript.~~ Done: `npm run judge` builds packets (neutral, both orders, stacked or side by
   side), keeps keys out of them and scores answers with controls; see [`docs/judging.md`](judging.md).
4. Fix gate definitions the proofs found weak: area jumps that count occlusion (P2), speed windows that return
   Infinity with few plants (P4), the thin-part metric's non-monotonic behaviour, and the borderline knight values
   (thin fraction at 0.25, stray pixels at 2).
5. ~~Performance.~~ Done, with byte-identical output: scalar ray maths and per-pixel culling made rendering 6-14x
   faster (P2 5.6 min to 7 s, demo 1.7 s to 0.12 s per frame); the determinism re-run is behind `--verify`. Next
   options that keep pixels: faster PNG compression and sheet assembly. Options that change pixels: analytic ray
   intersection, fewer sub-samples.
6. Stray pixels (done for outlines): almost all strays in selective-outline characters (182 of 197 across the ten
   examples) were outline pixels coloured by a different bordering part than their outline neighbours. The renderer
   smooths those after drawing the outline, leaving 8; the rest are single pixels of `allowThin` parts.
7. Quadruped gaits are fragile: short legs exceed the knee-speed gate at ordinary speeds (the unicorn), and turning
   broke the dragon's walk until it slowed to 0.1 m/s. Tune the planner for short-legged and many-legged bodies as
   part of the general limbs work.

Exit: all proof suites pass from the library; cloth is visible in rendered frames; one command per proof.

## Phase 1: minimum viable tool (next)

1. ~~**Skins v1.**~~ Done through P7: per-part sprites for eight directions with view buckets and pivots, RotSprite
   rotation, skin validation, the fit check, and an AI artist guide alongside [`docs/authoring.md`](authoring.md).
2. **Interfaces.** `pinata check`, `pinata render` and `pinata export` as a CLI, and an MCP server wrapping them, so
   agents in Claude Code and other clients use the tool directly.
3. **Export.** Sprite sheets with JSON frame data, Aseprite files; Spine/Rigby export later.
4. **Behaviour library.** Walk, run, idle, turn, pivot and jump (built), plus crouch and a simple attack, each with
   gates in the P4 style.
5. **Authoring hints.** Act on the P5 authors' notes: decals for small features, stride-to-leg-length guidance and
   diagnosis, palette budgeting, radius vs diameter wording, a reliable edit path for agents.

Exit: an agent, from a prompt, produces an 8-direction walking, idling and jumping character with a cape, skinned,
exported as a sprite sheet, and it passes every gate.

### P7: skins to a game-art bar

**Visual bar:** characters must stand up to game art, wherever they are used (game sprites or characters in a web
UI). A mascot that looks hand-made beats one that looks procedural in any context, so this bar applies to the whole
product. P8 settles delivery and performance; P7 settles visual quality; neither waits on the other, and the skins
compositor is also the fastest real-time renderer, so a P7 pass helps P8.

Prove that an AI artist can draw skins for 8 directions (or 4 plus mirroring) that stay consistent across views,
survive walking and reactions, and read at 32, 48 and 64 px. Scope beyond the skins spike: clean rotation (pre-drawn
angle variants for limbs, or a RotSprite-style algorithm instead of nearest-neighbour 22.5 degree steps) and a first
readability layer (exaggerated contact and passing poses, holds). Gates to fix before building it:
- Artist finishes a full directional skin set within a small budget of runs.
- Blind judges, using references of known high quality and both a detection and a 1-5 quality-rating question
  (the detection-only control rule broke down once the candidate was competitive), rate the skinned character at
  least as high as the references on average.
- A walk strip in every direction is preferred over the procedural renderer by a majority.
- One human pixel artist reviews the results (the only human check kept in the plan).

**Status:** built and released (v0.3.0): RotSprite rotation (off by default), eight-direction skins for the four
humanoids, a readability layer, skins in the world. Passed: artist, view consistency, real-time, quality against
references (second round). Failed: rotation preference, readability. Open: the size gate (needs per-size skins),
the human review. Live capes on skinned characters are built on the page: the artist's cape, cloak, robe and scarf
sprites are drawn along their simulated cloth ([natural-motion plan](plans/done/2026-11-02-natural-page-motion.md)).
Details in the [P7 plan](plans/2026-10-31-p7-skins.md). Later attempts to close the gap to hand-drawn game sprites
(a beat-and-pose stage, hand-drawn walk frames, a restyle with bigger heads and stronger shading) missed their gates,
so the bar is settled where it is and human-drawn skins remain the way past it.

**Honest risk:** game-quality art is where the evidence is thinnest. If P7 cannot reach strong references even with
clean rotation and pose exaggeration, serious game work needs human-drawn skins, and Piñata supplies motion, physics
and composition rather than the art. That is still a useful product; the import path below makes it work either way.

## Phase 2: depth (after the MVP)

- **Animation readability.** P4 showed a kinematically correct walk is not automatically readable at 48 px; skins
  helped, but animators also exaggerate contact and passing poses, hold key frames and draw smears. Add an
  exaggeration and timing layer on top of the physics, with judge-checked readability.
- **Environment.** Slopes and stairs (foot IK to terrain), wind fields and obstacles for cloth, water drag.
- **Body variety.** Non-humanoid rigs (quadrupeds, tails, wings) and props with constraints (two-handed weapons).
- **Import.** Bring in hand-made part sprites from Aseprite so human artists can supply skins directly, plugging into
  the same rig. AI skins become a starting point, not a ceiling. Pull this forward if P7 falls short of the bar.
- **Runtime exports.** Godot and Unity importers; Rigby2D/Spine interop.

## Risks and open questions

- **Visual quality is the main risk.** Skins are promising but proven only for one character, one view, against
  modest references. P7 decides whether the visual layer is AI-drawn skins or human-supplied art.
- **Judge reliability.** AI judges were reliable for ground-truth questions (materials, wind, facing in 3/4 view,
  prompt matching) and for detecting obviously procedural art, but unreliable for facing from a pure side view and
  once the candidate became competitive. Keep ground-truth questions, add quality ratings with strong references,
  and keep one human expert review before any public claim of quality.
- **Competition.** For game assets: Rigby2D, Keyframe.it and Sprite Studio all gained MCP support in 2026. For web UI
  characters: Rive (designer-authored interactive state machines with a web runtime) and Lottie (canned animation).
  The differentiators (characters generated from a prompt, physics-driven reactions, composable checked behaviours,
  style-independent motion) need to ship before these converge.
- **Annoyance.** UI companions have a history of irritating users (Clippy, Bonzi). The web component must be quiet by
  default, easy to dismiss, respect `prefers-reduced-motion`, and never block the page; assistance (speech bubbles,
  hints) is an opt-in layer whose content the host app supplies.
- **Small sizes.** 32 px is at the edge of what parts-based rendering can carry; many gates sit at their limits for
  the knight. Treat 48 px as the default and 32 px as a stretch target.

## Going public

Make the repository public when Phase 1 exits and P7 passes, with a README that states the results honestly, a demo
(an agent creating a character from a prompt, then the same character walking in several directions as game sprites
and reacting live in a web page), the authoring guide, and examples.
