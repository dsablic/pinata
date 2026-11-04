# TODO

Where the project stands and what to do next, written so a fresh session (or another machine) can pick it up.
Background: [`docs/FINDINGS.md`](FINDINGS.md) (what the proofs established) and [`docs/ROADMAP.md`](ROADMAP.md)
(the plan). Open plans are in [`docs/plans/`](plans); finished and settled ones, with the proofs' findings and judge
artefacts, in [`docs/plans/done/`](plans/done).

## Current state

- The proofs (P1-P6, the skins spike), general limbs, the joint hierarchy, the live runtime (P8: `<pinata-character>`,
  the hanging piñata, the Claude Code mod) and the world showcase are done; results in [`FINDINGS.md`](FINDINGS.md).
- Humanoids move by retargeted CMU motion capture with motion matching, feet held on the ground and a light physical
  body ([motion data](plans/done/2026-10-30-motion-data.md)); jumps play CMU take-off and landing takes
  ([jump takes](plans/done/2026-11-04-jump-takes.md)). Node and Chrome compute Math functions differently, so the
  engine is deterministic per engine, not across them.
- Characters live on an ordinary web page: marked elements are ground and walls, characters walk, drop, jump (super
  jumps on the demo) and react to the page; capes, cloaks, robes and plumes are simulated cloth drawn in the skins;
  one strip painter draws every part ([page world](plans/2026-10-31-page-world.md),
  [natural page motion](plans/done/2026-11-02-natural-page-motion.md),
  [unified part rendering](plans/done/2026-11-02-unified-part-rendering.md)). Released as v0.6.0.
- The visual bar is settled where it is: a beat-and-pose stage, hand-drawn walk frames and a restyle of the knight
  each missed their judge gates against hand-drawn game sprites
  ([drawn, not pasted](plans/done/2026-11-03-drawn-not-pasted.md),
  [drawn walk frames](plans/done/2026-11-03-drawn-walk-frames.md),
  [game sprite style](plans/done/2026-11-04-game-sprite-style.md)).

## Next: Phase 1, the minimum viable tool

[Plan](plans/2026-11-04-phase-1-tool.md), gates fixed: an agent, from a prompt, produces an eight-direction
character that walks, idles and jumps, with a cape, skinned, exported as a sprite sheet, passing every gate. Batches:
A recorder and export, B one command line and the MCP server, C behaviours and Aseprite, D authoring and the exit
test. Batch A (recorder, sheet and JSON export, the loop, feet, direction-packet and round-trip gates) is built;
the direction panel missed. Batch B (`pinata` and `pinata mcp`) is built.

- **Export:** sprite sheets with JSON frame data, then Aseprite files.
- **Behaviour library:** idle, crouch and a simple attack beside walk, turn and jump, each with gates, built on the
  [composable behaviours](plans/2026-10-30-composable-behaviours.md) model.
- **Packaging:** `pinata` runs from a checkout only, because Node does not strip types under `node_modules`; batch D
  compiles a JavaScript bin to `dist/` so `npx pinata` works. Standalone executables, if wanted later, are Node single
  executable applications built in CI (still V8, so exports match what the tests check); not Bun, whose
  JavaScriptCore computes `Math` differently from Node.
- **Authoring hints:** the P5 authors' notes (decals for small features, stride guidance, palette budgeting, a
  reliable edit path for agents).

- **Facing readability (Phase 1, batch A):** the skins' views do not read as their direction: judges named the
  direction right in 46% of answers (three-quarter views read as front or side; the wizard's back views show a white
  patch at the head that reads as a face, so back reads as front). Also open from batch A: the feet-held gate on drawn
  pixels (slides of 1 to 5 px as the boot is redrawn) and the rogue's boots drawn below the ground line.

## Open, from earlier work

- **Page world** ([plan](plans/2026-10-31-page-world.md)): the standing gate is missed narrowly on every layout
  (0.4-0.9% of frames mid-air from the turn, start and stop clips; about 0.3% of planted feet over 1 px); the
  corrective-step overlap in the turn clips. Super jumps miss their count on the perception layout (too few planned).
  After changing a test page or the demo, run `npm run layouts`.
- **Page motion leftovers:** one pop each for the knight (its sword behind the cape in the back view) and the dwarf
  (its cloak folding within a frame); the wizard's walk and landing judged less natural than before the natural-motion
  work (head turning away for frames, legs tucked under the robe); the rogue's worst flicker window and the dwarf's
  and wizard's cloth flicker; one knight foot sprite misses the fit check (a mirrored view draws it on the other
  foot's bone). A take ends in the take's small landing whatever the height, and a fall starting during a take's
  crouch loses the procedural reach-down and dip.
- **P7 skins** ([plan](plans/2026-10-31-p7-skins.md)): the size gate (per-size skins) and the human review.
- **Image and points** ([plan](plans/2026-10-30-image-points.md)): batches B and C, the point-driven workflow (an
  image plus arbitrary points, no fixed body parts).
- **World showcase** ([plan](plans/2026-10-30-world-showcase.md)): weather and particles (batch F), the physics engine
  spike (batch D).
- **Per-character motion settings:** a few settings per character applied to every retargeted take, as an
  auto-rigging tool's clip sliders do: arm space (bulky characters' arms clear their torso, which the knight's and
  dwarf's do not), stride scale and playback speed; one setting per character in the retarget step, judged by the
  glitch survey and a blind panel. A browsable page of every take on every skin helps pick takes.
- **General limbs:** several examples sit exactly on `maxThinFraction` (0.25); a very soft appendage on a very fast
  spin flails (swing frames are singular near 180 degrees), which no script does today.
- **Judging:** strip panels use the stacked layout (side by side, long strips read as one); control strips from
  different runs differ more than a control should.
- Drafts kept outside the engine: the knight's hand-drawn walk frames ([`pocs/drawn-walk/`](../pocs/drawn-walk)) and
  its restyled skin ([`pocs/game-sprite-style/`](../pocs/game-sprite-style)); the walk-frames renderer is in the
  history at 2ca4379.

## Smaller items

- [ ] Rigid-body behaviours in the engine: root with full 3D orientation, `hang`, scripted `hit`.
- [ ] Stray pixels left after the outline fix: single pixels of `allowThin` parts peeking past their neighbours
      (the unicorn's mane and ears; the author opted into thin parts, so they are left alone) and a few isolated
      outline pixels (knight, spider).
- [ ] Quadruped gait tuning for short legs (knee speed) and turning (the dragon only passed at 0.1 m/s, no turn).
- P2 gate `partAreaJump` counts occlusion as instability; P2's fail stays as recorded, and area change is measured
  with the image-and-points `areaChange` gate instead.
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
- Page world: `npm run gates` (standing, flicker, jumps; `--landings`, `--jumps`, `--super-jumps`, `--jump-takes`),
  `npm run glitches` (the survey, about an hour), `npm run rendering-panel`, `npm run game-panel -- <LPC dir>`,
  `npm run jump-panel`, `npm run skin -- fit <dir>`; `npm run site && npm run test:browser` for Chrome.
- Proof runners: `npm run p1` ... `p6`, `npm run check -- <dir>`, `npm run demo`, `npm run skins -- <skin.json>`; add
  `--verify` (or `npm run pN:verify`) for the determinism re-run.
- Fix gates in a plan before building; only tighten them afterwards, and log why; add a control that must fail.
- After each batch, an independent review told to assume the code is wrong; fix before moving on.
- Visual quality is judged by blind AI judge panels (fresh agents, neutral names, both orders, controls), not by eye.
- TypeScript only in the repo; scratch scripts may use anything.
- Write the name as "Piñata" in prose; keep `pinata` in identifiers, paths and commands.
- Commit messages: a short subject, the Co-Authored-By trailer, no body unless needed. Push at milestones.
