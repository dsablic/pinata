# TODO

Where the project stands and what to do next, written so a fresh session (or another machine) can pick it up.
Background: [`docs/FINDINGS.md`](FINDINGS.md) (what the proofs established) and [`docs/ROADMAP.md`](ROADMAP.md)
(the plan).

## Current state

- All proofs are done (P1-P6 and the skins spike); results in [`docs/FINDINGS.md`](FINDINGS.md).
- General limbs ([plan](plans/2026-10-30-general-limbs.md)): batches A-D are done and reviewed. Format, templates,
  N-segment IK, gait and pose for any limbs, appendage dynamics (spring and oscillator), balance and appendage gates,
  `npm run new`, the beetle, spider and horse examples (lineup in [`docs/assets/lineup.png`](assets/lineup.png)) and
  the authoring guide. Existing outputs are byte-identical (only wall-clock timing in `metrics.json` differs).
- The balance gate applies to rigs with more than four legs (confirmed; even leg counts for now).
- Direction (user, 2026-10-30): a character is an image plus any number of points; the engine animates the points and
  the image follows by a 2D mesh warp; templates are starting points to refine, never limits. Draft plan:
  [image and points](plans/2026-10-30-image-points.md), waiting for review.
- Specs written, not started: live runtime spike P8 ([spec](plans/2026-10-30-runtime-spike.md)) and composable
  behaviours ([spec](plans/2026-10-30-composable-behaviours.md)).
- Provisional logo: a hanging unicorn piñata, seamless loop, in [`docs/assets/`](assets). It was rendered by a
  throwaway prototype script (not in the repo); the engine cannot yet do hanging or hits natively (see "Rigid-body
  behaviours" below).

## Next, in order

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
- [ ] P2 gate `partAreaJump` counts occlusion as instability; redefine on unoccluded footprints in a future version.
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
