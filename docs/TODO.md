# TODO

Where the project stands and what to do next, written so a fresh session (or another machine) can pick it up.
Background: [`docs/FINDINGS.md`](FINDINGS.md) (what the proofs established) and [`docs/ROADMAP.md`](ROADMAP.md)
(the plan).

## Current state

- All proofs are done (P1-P6 and the skins spike); results in [`docs/FINDINGS.md`](FINDINGS.md).
- General limbs, the joint hierarchy (image-and-points batch A), the live runtime (P8: `<pinata-character>`, the
  hanging piñata, the Claude Code mod) and the world showcase are done and reviewed.
- Natural motion ([plan](plans/2026-10-30-motion-data.md)): humanoids move by retargeted CMU motion capture with
  motion matching, feet held on terrain and a light physical body; batches A-C done and reviewed; released as v0.2.0
  (the Pages site shows it). Cross-engine determinism was dropped (user): Node and Chrome compute Math functions
  differently. `src/motion/walker.ts` is a first draft of a physical body for creatures without capture data.
- Direction (user, 2026-10-30): reach game-worthy pixel-art animation, working through this list autonomously.

## Next, in order

### 0. P7: skins to a game-art bar

[P7 plan](plans/2026-10-31-p7-skins.md): clean rotation (RotSprite), eight directions, AI-drawn skins for the four
humanoids, a readability layer, judged against strong references, then skins in the world. Batch A (clean rotation)
first.

### 0b. World showcase, remaining batches

[World showcase plan](plans/2026-10-30-world-showcase.md): weather and particles (F), styles and skins (G, folds
into P7 batch D), physics engine spike (D), page-as-world (E). Once page-as-world works, rework the world demo to
use the page's elements instead of the generated terrain (user, 2026-10-31).

### 1. Leftovers from general limbs

- [ ] Several new examples sit exactly on `maxThinFraction` (0.25).
- [ ] Appendages: a very soft appendage on a very fast spin flails (swing frames are singular near 180 degrees); no
      script does that today.

### 2. Live runtime spike P8, with composable behaviours phase 1

[Runtime spec](plans/2026-10-30-runtime-spike.md) and [behaviours spec](plans/2026-10-30-composable-behaviours.md):
- [ ] Browser bundle of the engine (esbuild, no Node built-ins), compact single-file character artifact.
- [ ] Online (frame-by-frame) motion for the hanging piñata: spherical pendulum on a rope with twist, full 3D body
      orientation, limp legs and mane as cloth chains, `hit()` events.
- [ ] Composition evaluator (base, limb-masked layers, additive overlays, events, blending, state machine) with
      `hang`, `sway`, `spin`, `bounce`, `breathe`, `hit`; the five behaviours in a `behaviours.json`.
- [ ] `<pinata-character>` element, event bridge (`loading`, `toolStart`, `error`, `success`, `idle`), poke and drag,
      reduced motion, page stays clickable.
- [ ] Playwright tests (add Playwright via the npm safe-install skill): p95 frame time <= 40 ms at 64 px, hit
      reaction, behaviour switching, Node-browser determinism, event bridge, poke/drag, reduced motion, no console
      errors, saved stills.
- [ ] Decision: procedural renderer good enough for the runtime, or skins first.

### 3. P7, in parallel with P8: skins to a game-art bar

[ROADMAP.md, "P7"](ROADMAP.md): 8-direction AI-drawn skins, clean limb rotation (angle variants or RotSprite-style),
a first readability layer (exaggerated contact and passing poses, holds), consistency at 32/48/64 px; judged against
high-quality references with a 1-5 rating plus detection, and one human pixel artist review. Fix gates in a plan
before building.

## Smaller items

- [ ] Rigid-body behaviours in the engine (needed by P8 anyway): root with full 3D orientation, `hang`, scripted `hit`.
- [ ] Stray pixels left after the outline fix: single pixels of `allowThin` parts peeking past their neighbours
      (the unicorn's mane and ears; the author opted into thin parts, so they are left alone) and a few isolated
      outline pixels (knight, spider).
- [ ] Quadruped gait tuning for short legs (knee speed) and turning (the dragon only passed at 0.1 m/s, no turn).
- P2 gate `partAreaJump` counts occlusion as instability; decided (2026-10-30) to leave P2's fail as recorded and to
  measure area change with the image-and-points `areaChange` gate instead.
- [ ] Remaining renderer speedups that keep pixels: PNG compression and sheet assembly.

## Logo

The logo animation was made with throwaway scripts that are not in the repo. To regenerate it with the engine, the
rigid-body behaviours (hang, periodic hit) and appendages are needed. Settings that produced it: unicorn piñata with
stride 0.22 m and speed 0.2 m/s (legs stop crossing), rope 0.7 m, hit every 4 s (impulse about 1.3 m/s sideways,
spin 2.2 rad/s), swing damping 0.55/s, twist spring 5 with damping 1.1, constant wind 0.6 m/s, 8 warm-up cycles,
one 4 s cycle recorded at 24 fps, 64 px, azimuth 40 degrees, elevation 10 degrees. Seam check: 0.36% of pixels differ
between the first frame and one cycle later (normal frame-to-frame change is about 2%).

## How to work on this project

- Node 24+, TypeScript run directly (type stripping), no build: `npm install`, `npm test`, `npm run typecheck`.
- Runners: `npm run p1` ... `p6`, `npm run check -- <dir>`, `npm run demo`, `npm run skins -- <skin.json>`; add
  `--verify` (or `npm run pN:verify`) for the determinism re-run.
- Fix gates in a plan before building; only tighten them afterwards, and log why; add a control that must fail.
- After each batch, an independent review told to assume the code is wrong; fix before moving on.
- Visual quality is judged by blind AI judge panels (fresh agents, neutral names, both orders, controls), not by eye.
- TypeScript only in the repo; scratch scripts may use anything.
- Write the name as "Piñata" in prose; keep `pinata` in identifiers, paths and commands.
- Commit messages: a short subject, the Co-Authored-By trailer, no body unless needed. Push at milestones.
