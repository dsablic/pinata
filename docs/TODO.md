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

### 0. Drawn walk frames

[Plan](plans/2026-11-03-drawn-walk-frames.md): the walk drawn as hand-made whole-body frames, picked by distance
travelled so planted feet stay put, the cut-outs kept for everything else. The knight's side walk first, judged alone
against clothed references before the other skins are drawn. It follows
[drawn, not pasted](plans/2026-11-03-drawn-not-pasted.md), whose beat-and-pose stage made the game-like ratings fall.
Batch A is built (the skin's `walk`, phase from distance, planted-sole placement, the gates on a test walk; the landing
squat fix is not: it raised the dwarf's pops); its numbers are in the plan. Next: batch B, the knight's drawn side walk, then the knight-alone round. The
switching gate misses on the test walk (leaves at a stop), so the drawn frames need a pose near the cut-out's slowing
step, or the leave rule needs the art's help.

### 0. Natural motion on the page, game-like visuals

[Plan](plans/2026-11-02-natural-page-motion.md): secondary motion (chains, cloth, a robe hem) in the page world, cloth
drawn in skins, natural falls and landings, jumps up the page, structural draw order; judged against the old terrain
demo and strong references. Batches A (secondary motion), B (cloth in skins), C (landings that dip and absorb, legs
reaching down in falls) and D's jump mechanics (jump edges up to a leg length, ballistic arcs, gated on a recorded
jump page) done. The demo and page layouts' rises are 1.5-5 m, beyond a leg-length jump, so characters climb the
page with super jumps (`jumps: 'super'`, a checkbox on the demo; the gate is met on three of four layouts, perception
has too few planned jumps). Next: CMU take-off and landing takes for jumps, then batch E.

### 0. Unified part rendering on the page

[Plan](plans/2026-11-02-unified-part-rendering.md): a standing glitch survey (`npm run glitches`), then one strip
painter, steady draw order and joints snapped once for every part on the page. All three batches are built: no torn
parts or blank frames, far fewer pops, cheaper frames. Still missed: the knight's and dwarf's pops, the rogue's worst
flicker window, the dwarf's and wizard's cloth flicker, and the judge gate (the judges could not tell the renderers
apart in three rounds, leaning slightly to the old one). Batch D redrew the skin sprites that did not fit their bones
from the page camera: the knight's pops fell from 17 to 1; one knight foot sprite still misses the fit check, since a
mirrored view draws it on the other foot's bone and a skin cannot hold a sprite for the mirrored view.

### 0. P7: skins to a game-art bar

[P7 plan](plans/2026-10-31-p7-skins.md): built and released as v0.3.0 (eight-direction skins for the four humanoids,
skins in the world). Left: the size gate (per-size skins), the human review. Live capes on skinned characters are
built on the page (natural-motion batch B).

### 0a. The page as the world

[Page-world plan](plans/2026-10-31-page-world.md): marked DOM elements become ground and walls, characters walk,
step and drop between them on a click-through overlay, react to the page, and the front page is built on it. All
four batches built and reviewed. The standing gate is missed narrowly on every layout
(`npm run gates`: 0.4-0.9% of frames mid-air, from turn, start and stop clips, and about 0.3% of planted feet over
1 px). Next for it: the corrective-step overlap in the turn clips, and jumping, so characters can climb. The page
world is checked in Node on recorded layouts ([harness plan](plans/2026-11-02-page-harness.md)); after changing a
test page or the demo, run `npm run layouts`.

### 0b. World showcase, remaining batches

[World showcase plan](plans/2026-10-30-world-showcase.md): weather and particles (F), styles and skins (G, folds
into P7 batch D), physics engine spike (D), page-as-world (E, now the page-world plan above). Once page-as-world
works, the world demo is rebuilt on the page's elements instead of the generated terrain (done: the front page).

### 0c. Per-character motion settings

A few settings per character applied to every retargeted take, as an auto-rigging tool's clip sliders do: arm space
(the arms held out so bulky characters' arms clear their torso, as the knight's and dwarf's do not), stride scale and
playback speed. One setting per character in the retarget step, not a fix per take; judged by the glitch survey and a
blind panel. A browsable page of every take retargeted onto every skin helps pick takes (the jump takes first).

### 1. Leftovers from general limbs

- [ ] Several new examples sit exactly on `maxThinFraction` (0.25).
- [ ] Appendages: a very soft appendage on a very fast spin flails (swing frames are singular near 180 degrees); no
      script does that today.

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
