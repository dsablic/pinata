# Piñata Roadmap

The goal, what the evidence says about the distance to it, and the order of work that closes the distance.
[`docs/TODO.md`](TODO.md) says what is next in detail, [`docs/FINDINGS.md`](FINDINGS.md) what the proofs established.
Open plans are in [`docs/plans/`](plans). A finished plan is removed once its results are in the findings; the
proofs' findings and judge artefacts stay in [`docs/plans/done/`](plans/done).

## Goal

An AI agent points Piñata at character art (one view or several; drawn by a person, by the agent or by an image
model) and the tool helps it reach fluid, game-worthy animation: sprites that stand beside hand-animated game
characters, exported for game engines and playable live on a web page.

Three things follow from it, and every item below is ordered by them:

- **Any art.** The way in is existing artwork with points placed on it, not only a mannequin written from nothing.
  Nothing in the engine depends on named body parts: a point is a point, and what moves it is configuration.
  Templates (biped, quadruped, hexapod, octopod) are starting points to refine.
- **Game-worthy is the bar.** Animation is compared with hand-animated game sprites, not with earlier versions of
  itself. Correct motion is not enough; it has to read as a game character's.
- **A general tool.** Quality comes from mechanisms that help any author's character (checks, guidance, the renderer,
  the motion library). The example characters are test cases, fixed only as far as the general checks fail them.

## Where it stands against the goal

| Part of the goal | Evidence | Standing |
|---|---|---|
| An agent authors a character with the tool | Phase 1's exit test: three of three fresh agents reached an exported, skinned, eight-direction character within 10 `check` runs; judges matched every character to its prompt | Met |
| The engine moves it correctly | Planted feet, IK, simulated cloth, retargeted capture with motion matching, style independent of motion, deterministic per JavaScript engine | Met |
| The agent points the tool at existing art | No import path exists; the [import plan](plans/2026-11-05-import-existing-art.md) has its gates and no code | Not started |
| Any shape, not only bodies with named parts | The point hierarchy and drivers are built ([image and points](plans/2026-10-30-image-points.md), batch A); the points format, the warp renderer and the point helper are open | Started |
| Motion reads as game animation | The owner's blind review against hand-animated sprites: 3 of 8 pairs, then 1 of 8 with 3 ties (the gate asks 5). The walk is preferred and the runs tie; idles, attacks and the jump lose | Missed |
| Art reads as game art | AI-drawn skins beat modest CC0 references; three attempts against hand-drawn game sprites missed their gates | Settled where it is |
| Directions read | Fresh agents' characters: 60% idle and 65% walk against gates of 90% and 80%; a hand-drawn control reaches 81% with the same judges. Three-quarter views carry the misses | Missed |
| Motion can be measured without the owner | A pooled AI panel sees none of four degraded dimensions; one model alone sees all four | Open |

What the table says:

- **The engine and the authoring loop work.** The distance to the goal is in two places: the way in (existing art)
  and game feel.
- **Capture gives locomotion, not performances.** Retargeted capture holds up for walks and runs. Idles, attacks and
  jumps taken from capture of everyday actions do not read as a game character's: a game animation is a few chosen
  poses with timing (anticipation, a fast strike, follow-through, a held end), and that layer is not built. P4 found
  the same for walks at 48 px, and the beat-and-pose stage that tried it on drawn frames missed its gate, so this is
  the oldest open finding and the one nearest the goal.
- **Every motion verdict so far also judges the art.** The review pairs Piñata's AI-drawn skins with another artist's
  sprites. Imported art animated against its own hand animation (the LPC sheets: walk, slash, thrust, cast) is the
  first comparison where only the motion differs.
- **The live page has drawn much of the recent effort** (standing, flicker and count gates within a percent of their
  thresholds). It serves the goal as a delivery target and a demo; closing its last gates does not move the goal.

## Product definition

- **Users:** AI agents first (through MCP and the command line), and the people directing them: indie developers and
  small studios who need many animated characters without an animator, and web developers who want small reactive
  characters on their pages.
- **Inputs:** character art with points (imported from a sprite, an illustration or an image model's output), or a
  character package written by an agent from a prompt. Both become the same text package: rig, points, materials,
  motion, skin, style.
- **Outputs:** two delivery targets from the same engine and files, held to the same bar:
  - game assets: animated sprites in four or eight directions (sprite sheets with JSON, Aseprite files);
  - the live web runtime: `<pinata-character>` and the page as the world.
- **Core promise:** the agent says what should happen; the tool makes it physically right, gives it game feel, and
  tells the agent precisely what to fix when it is not.
- **Not in scope:** an editor GUI and a full game-engine runtime (game exports target existing engines). No model in
  the export path: model output enters as stored files ([ML proposal](proposals/ml-augmentation.md)). The motion core
  stays 3D so a 3D renderer and glTF export stay possible; neither is planned.

## How progress is judged

- **Motion quality:** the owner's blind review page (pairs against hand-animated references, sides shuffled, "which
  would you ship"). It is the gate of every motion plan. Eight pairs from one reviewer move by two or three on
  chance, so a round carries enough pairs to tell a change from noise, and same-art pairs wherever a reference has
  them.
- **Between rounds:** numbers the tool computes on both sides (frames per cycle, distinct poses, the share of held
  frames, pops, cloth lag, foot slide on drawn pixels) and an AI judge only on dimensions it is shown to see.
- **Ground truth** (directions, prompt matching, materials): blind AI panels, calibrated on hand-drawn controls.
- **Everything else:** gates fixed in a plan before building, a control that must fail, an independent review of
  each batch, `npm run verify`.

## What counts as progress

The effort since Phase 1 went into narrow gates, judging instruments and tweaks to capture takes, and the owner's
review moved from 3 of 8 to 1 of 8. To keep the work on the goal:

- **A milestone is something the owner can watch:** art that went in, an animation that came out, on the review page
  beside a hand-animated reference. A batch that ends in a number alone is a step, not a milestone.
- **Work comes from the order below.** A parked item is picked up only when an item in the order is blocked on it.
- **A narrow miss is recorded and left.** A gate missed within a few percent on something off the path gets a line
  in [`TODO.md`](TODO.md), not a batch.
- **Mechanisms, not adjustments.** A defect named in a review is answered by a capability every character gets (a
  pose layer, a check, an import step), not by another take or another constant for the example it showed on.
- **Instruments are built when an item needs one,** and only as far as it needs.

## Order of work

Each item is a plan with its gates fixed first. The order is by distance to the goal.

1. **Import existing art** ([plan](plans/2026-11-05-import-existing-art.md), batch A first): normalisation, points,
   the cut along the bones, the rig fit, hidden-area lists and view guides, on LPC, CC0, image-model and illustration
   inputs. It is the goal's first verb and the tool cannot do it yet; it also supplies the same-art pairs for every
   motion review after it. The plan's motion gate is read on walk strips by an AI panel, an instrument since found
   weak for motion, so the same pairs also go on the owner's page.
2. **Game feel** (the next plan, built on the two review rounds): performances as chosen poses
   with timing, for any character.
   - A pose-to-pose layer for idles, attacks, jumps and reactions: named phases (anticipation, strike,
     follow-through, hold, recover) with durations, authored as text by the agent or picked from a library, with
     capture kept for locomotion and as the source of in-between motion.
   - A resting pose as the base of every idle (weight on one leg, arms at rest or on what is carried), with the
     breath and weight shift on top and cloth that answers them.
   - Timing for export: holds at extremes and stepping on twos as a setting, and the classic feel filter
     (anticipation and follow-through from a smoothed second derivative), off by default.
   - `check` reads the phases (an attack with no anticipation, a strike no faster than its wind-up, an idle with a
     gesture in it, a jump with no crouch or landing) and says what to fix.
   - Judged by round three of the owner's page: the earlier pairs and the same-art LPC pairs from item 1.
3. **A motion measure between rounds** ([benchmark](plans/2026-11-05-animation-benchmark.md), batch B): the
   scorecard's computed numbers on both sides, and a single-model judge as a new gate fixed before its run. Small,
   and it runs beside items 1 and 2 because it shortens their loop.
4. **Views that read:** import batches B and C (missing views drawn over guides, hidden areas, the fresh-agent
   imports from all views and from one), with view providers tried against the agent as the proposal's experiment 2.
   The direction gates stay as fixed; the hand-drawn calibration says what they can show.
5. **More takes where game feel names a gap:** styled locomotion and generated attack takes entering as files (the
   proposal's experiment 4), retargeted and gated like the capture library.
6. **Any shape** ([image and points](plans/2026-10-30-image-points.md), batches B to D): `points.json`, the mesh
   warp renderer and the point helper, proved on a biped, a quadruped and something with no legs; then the decision
   on making image and points the default authoring path. After import, because import reaches the goal for bodies
   the templates cover with the renderer, export and gates that exist; the warp is what reaches the rest.
7. **Reach:** importers for Godot and Unity, Spine and Rigby2D interop, per-size skins (P7's size gate), effects
   and weather on the page.

Per-character motion settings (arm space, stride scale, playback speed) belong to item 2 where a review names them.

## Parked

Open and recorded in [`TODO.md`](TODO.md), not worked until an item above needs them or a user of the runtime does:

- the page world's narrow misses (frames mid-air, planted feet over a pixel, cloth flicker, jump and super-jump
  counts) and the restatement of its count gates per distance travelled;
- weather, particles and the physics-engine spike of the world showcase;
- rigid-body behaviours in the engine (`hang`, scripted `hit`, a root with full 3D orientation) beyond what the
  hanging piñata already does in the runtime;
- quadruped gait tuning for short legs and turns, stray pixels of thin parts, renderer speedups;
- further attempts to make AI-drawn skins pass as hand-drawn game sprites. Existing art is the way past that bar.

## Risks

- **Game feel may not come from a layer.** If poses with timing on rotated part sprites still lose to hand
  animation on the same art, the limit is the part-sprite renderer (the rotation and readability gates of P7
  missed), and the answer moves towards drawn key frames per pose or the mesh warp. Item 1's same-art pairs show
  which it is before much is built on either.
- **Cut sprites at small sizes.** A 48 to 64 px sprite cut into parts and rotated may lose the drawing's quality;
  the import round-trip gate sees the rest pose only. The motion gate on imported art is the check.
- **One reviewer.** The owner's eye is the bar for motion, and one human expert review is still owed before any
  public claim about art quality.
- **Judge reliability.** AI judges are reliable for ground truth, weak for motion in strips and for three-quarter
  views; no gate rests on a dimension the judges are not shown to see.
- **Competition.** For game assets: Rigby2D, Keyframe.it, Sprite Studio and the frame generators (PixelLab, Retro
  Diffusion). For web characters: Rive and Lottie. Piñata's difference is a fixed grid and palette, consistent
  directions, planted feet, physics-driven cloth and checked, composable behaviours; frame generators drift on all
  of these, and the benchmark's computed measures can show it.
- **Annoyance.** Page companions have a history of irritating users. The web component stays quiet by default, easy
  to dismiss, respects `prefers-reduced-motion` and never blocks the page.
- **Small sizes.** 32 px is at the edge of what parts-based rendering carries; 48 px is the default.

## Public claims

The repository is public and the README states results as measured. It makes no claim of game-quality animation
until the owner's review gate is met on imported art, and none of game-quality art from AI-drawn skins.
