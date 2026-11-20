# TODO

Where the project stands and what to do next, written so a fresh session (or another machine) can pick it up.
Background: [`docs/ROADMAP.md`](ROADMAP.md) (the goal and the order of work) and [`docs/FINDINGS.md`](FINDINGS.md)
(what the proofs and the finished plans established). Open plans are in [`docs/plans/`](plans).

## Current state

- The engine, the authoring loop and the tool work: `pinata new, check, skin, render, export, review` and the MCP
  server, the live runtime (`<pinata-character>`, the hanging piñata, the Claude Code mod) and the page as the
  world. Phase 1's exit test is met and released as v0.7.0.
- Humanoids move by retargeted CMU motion capture with motion matching; jumps play capture takes. Node and Chrome
  compute Math functions differently, so the engine is deterministic per engine, not across them.
- Against hand-animated game sprites, in the owner's blind review: the walk is preferred and the runs tie; idles,
  attacks and the jump lose (1 of 8 picked with 3 ties, against a gate of 5).
- The visual bar of AI-drawn skins is settled where it is; existing art is the way past it, and the tool cannot
  import it yet.

## Next: any art, animated well

The aim: an AI points the tool at character art (one view or several) and the tool helps it reach a fluid,
game-worthy animation. Quality is fixed in the tool (checks, guidance, renderer, motion library), not by hand-tuning
the examples. The owner's blind review page is the gate of motion quality; AI judges do not see motion in strips
reliably. In the roadmap's order:

1. **[Import existing art](plans/2026-11-05-import-existing-art.md), batch A:** gates fixed, not started.
   Normalisation, points, the cut, the rig fit, hidden-area lists and view guides, on LPC, CC0, image-model and
   illustration inputs; the [ML proposal](proposals/ml-augmentation.md) shapes its inputs (files plus optional
   providers). The imported LPC characters give the same-art pairs (walk, slash, thrust, cast) for the next review.
2. **Game feel:** a plan to write, gates first. A pose-to-pose layer with named phases (anticipation, strike,
   follow-through, hold, recover) for idles, attacks, jumps and reactions; a resting pose under every idle with
   cloth that answers the breath; holds, stepping on twos and the feel filter as export settings; `check` reading
   the phases. Judged by round three of the owner's page with the earlier pairs and the same-art pairs, and with
   enough pairs to tell a change from chance.
3. **[Animation benchmark](plans/2026-11-05-animation-benchmark.md), batch B:** the scorecard's computed numbers on
   both sides; a single-model judge would be a new gate fixed before its run. Runs beside 1 and 2.
4. **Views:** import batches B and C, with view providers tried against the agent. The direction gates were missed
   by fresh agents' characters (60% idle, 65% walk against 90% and 80%); three-quarter views carry the misses.
5. **[Image and points](plans/2026-10-30-image-points.md), batches B to D:** `points.json`, the warp renderer and
   the point helper, for shapes the templates do not cover.

## Open, parked

Recorded, and not worked until an item above or a user of the runtime needs them (see the roadmap's "Parked").

- **Exports:** the feet-held gate on drawn pixels (slides of 1 to 5 px as the boot is redrawn); the rogue's boots
  drawn below the ground line; the knight's swing hides the sword behind the body for about eight frames in the side
  view; staff detection is by part name.
- **Packaging:** `npm run build` compiles a JavaScript bin to `dist/node`, so an installed package runs `npx pinata`
  and `npx pinata mcp`. Standalone executables, if wanted, are Node single executable applications built in CI; not
  Bun, whose JavaScriptCore computes `Math` differently from Node.

- **Page world** ([plan](plans/2026-10-31-page-world.md)): the standing gate is missed narrowly on every layout
  (0.4-0.9% of frames mid-air from the turn, start and stop clips; about 0.3% of planted feet over 1 px); the
  corrective-step overlap in the turn clips. Super jumps miss their count on the perception layout (too few planned).
  After changing a test page or the demo, run `npm run layouts`.
- **Count gates per distance travelled:** restate the page's count gates per distance travelled, in a plan with gates
  fixed first. Characters walk at leg-length speeds, so the fixed 60 s holds fewer trips and the dwarf's jump count
  (39 of 40) and the page-test layout's super jumps (3 of 4) are missed.
- **Page motion leftovers:** one pop each for the knight (its sword behind the cape in the back view) and the dwarf
  (its cloak folding within a frame); the wizard's walk and landing judged less natural than before the natural-motion
  work (head turning away for frames, legs tucked under the robe); the rogue's worst flicker window and the dwarf's
  and wizard's cloth flicker; one knight foot sprite misses the fit check (a mirrored view draws it on the other
  foot's bone). A take ends in the take's small landing whatever the height, and a fall starting during a take's
  crouch loses the procedural reach-down and dip.
- **The knight's cape flicker:** the drawn-cloth
  flicker gate of the page is missed for the knight (1.50 and 2.13 against at most 1 %); the cape's own flicker is
  unchanged by the painter's rest-relative steps, and the gate's difference of two runs' worst frames moves with
  frame alignment. Open: the cape's flicker.
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
- Finished plans are removed once their results are in [`FINDINGS.md`](FINDINGS.md); the last commit holding them
  all is 1c482e4.

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
- Ground-truth questions (directions, prompt matching) are judged by blind AI judge panels (fresh agents, neutral
  names, both orders, controls); motion quality by the owner's blind review page.
- TypeScript only in the repo; scratch scripts may use anything.
- Write the name as "Piñata" in prose; keep `pinata` in identifiers, paths and commands.
- Commit messages: a short subject, the Co-Authored-By trailer, no body unless needed. Push at milestones.
