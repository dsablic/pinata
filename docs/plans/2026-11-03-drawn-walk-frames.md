# Drawn Walk Frames

Two game-like rounds ([drawn, not pasted](2026-11-03-drawn-not-pasted.md)) say the same thing: the strongest judge
picks every page strip as software because its parts are rotated and slid rather than redrawn, and a beat-and-pose
stage on the cut-outs made the ratings fall. Game sprites are drawn as whole frames. This plan draws the walk, the
motion most on screen, as hand-made whole-body frames that the motion system picks, and keeps the cut-outs for
everything else (turns, falls, landings, jumps, standing). It starts with one character in one view and is judged
before more art is drawn.

## Design

- **Frames in the skin.** A skin may carry, per view, a walk: a list of whole-body frames, each a palette grid like a
  part sprite, with the pixel of each sole marked (`soles`, the ground point under each foot) and which foot is
  planted on that frame. One cycle is two steps; eight frames is the usual count.
- **Phase from distance.** The drawn stride is the distance a planted sole moves backwards relative to the body over
  a cycle, read from the frames' sole marks. The cycle's phase advances by the distance the character travels,
  divided by that stride at the page's scale, so a planted foot stays on its ground pixel by construction: the frame
  is placed so its planted sole sits on the ground at the walker's position, and the frame changes when the phase
  crosses its slot. The walker's own feet are not drawn while frames show; its position, facing and surface are.
- **When frames show.** While the character walks on a surface at a speed inside the frames' range, faces within the
  view's sector, and is not falling, jumping, landing or turning on the spot; entering and leaving use hysteresis on
  speed and facing, and the switch happens at a frame whose pose is close to the cut-out's (a contact frame), so the
  silhouette does not jump. Anything else draws the cut-outs as now.
- **Cloth.** The frames carry their cape or robe as drawn; the cloth simulation keeps running so the cut-outs pick up
  where the frames leave off.
- **The art.** The knight's side walk first, at the page's sprite scale, drawn over the cut-out's own poses as a
  guide (the proportions, palette and outlines stay the knight's), then redrawn by hand frame by frame: contact,
  down, passing and up poses with knees and arms bending through them, the body bobbing on the beat, the cape
  swinging, a clean outline in every frame.
- **The landing squat.** The landing dip's recovery is the deep squat the knight walks in after a drop-in; it is
  fixed separately in the player and the walk strips' rule starts after a landing's recovery.
- **The panel.** The game-like panel with clothed references only: the LPC soldier, the soldier in its other colours,
  the princess, and the male base body wearing the LPC pants, frames 1-8 facing right.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical, except the page's sprites and outputs named as meant to change | a skin without frames draws as now |
| Planted feet | while frames show, over a minute of walking on every recorded layout, the planted sole's drawn pixel moves at most 1 px in x and y between frames of one stance | no skating |
| Switching | entering or leaving the frames changes the character's drawn silhouette by at most 25% of its pixels from the frame before, in at least 95% of switches; the survey's pops, fragments and stretch no worse than now | |
| Cost | at most 8 ms of main thread per frame at p95 in Chrome, four characters | |
| Knight alone | game-like round on the knight's side walk drawn from frames (as the page shows it) against the four clothed references, three judges on three models, both orders: the knight rated at least the references' mean, picked as software in at most 60% of non-control answers, and rated at least 3.5 by the largest-model judge | decides whether the rest is drawn |
| All four | the same round on every character's walk and landing strips after the other skins are drawn | the natural-motion plan's game-like gate, with clothed references |

## Batches

- **A. Frames in the format and the renderer:** the skin's walk frames, phase from distance, placement by the planted
  sole, when frames show, the planted-feet, switching and cost gates on a test skin; the landing squat. Review.
- **B. The knight's side walk:** the art, the knight-alone round. If it misses, a critique and one redraw round; if
  that misses too, the frames are not kept. Review.
- **C. The rest:** the knight's other views, then the rogue, dwarf and wizard; the all-four round; release. Review.

## Results

### Batch A: frames in the format and the renderer

Built: the skin's `walk` per side-like view, phase from distance, placement by the planted sole, the landing dip, the
gates. The test walk is eight of the knight's own cut-out poses from one steady cycle
(`test/fixtures/walk-frames/knight-side.json`, 39 x 54 px, drawn stride 33 px, the knight's walk at the page's 27
sprite pixels per metre: its cycle is 1.2 m). It is a stand-in for drawn art and does not ship.

- Existing outputs: a skin without frames draws byte-identically; the hash of every drawn sprite over 20 s on all five
  layouts is the same before and after (page-test, perception, jumps, demo-1200, demo-390), and `npm run
  rendering-panel` writes the same files after the frames work and after the landing change.
- Planted feet (60 s per layout, knight on the test walk): worst 0.00 px in x and y on all five layouts, over 388, 508,
  773, 484 and 224 frame pairs in 39, 42, 71, 48 and 29 stances. By construction the planted sole cannot move, so this
  gate checks the bookkeeping, not the art.
- Frames showing on walking steps: 60%, 78%, 77%, 72% and 44% (page-test, perception, jumps, demo-1200, demo-390).
- Switching on the test walk: 12 of 16, 5 of 8, 12 of 14, 13 of 16 and 15 of 16 switches within 25%: 57 of 70 in all,
  81%, below the 95% gate. Every miss is a leave at a stop: the cut-out standing still resembles no frame of a walk,
  and the cut-out's walk is not a repeating cycle, so the closest frame to its pose is typically 20 to 30% away even
  in the best step. With 13 frames from the same cycle the same gate reads 59 of 67; with 26 (one per step) 76 of 86.
  Entering is always within the threshold of its own step. Drawn frames will not resemble the mocap poses better than
  these do, so this gate is likely to be the hard one for the knight's art.
- Cost, browser suite p95 (page-test page, demo page, four characters): 2.00 and 4.90 ms with the test walk on the
  knight (site built with `npm run site -- _site --walk-frames=test/fixtures/walk-frames/knight-side.json`), 1.80 and
  2.50 ms without; the gate is 8 ms.
- Landing gates (`npm run gates -- --landings`): every number identical with and without the landing change below.
- The landing squat: a quicker rise out of the dip for a character walking on (a clock 4x as fast after 0.2 s took 4
  cm at 8 ticks to 0, leaving `rendering-panel` byte-identical and the landing and jump gates met) was built and left
  out: the survey's dwarf pops went from 1 to 3 at every setting tried (clock 1.5, 2 and 4, start 0.2 and 0.3 s),
  the rest unchanged. What stays: `LANDING_RECOVERY_SECONDS` (1 s), used by the walk frames (not shown until 1 s after
  the last air) and by the game panel's stride window, which now starts only after a landing has recovered. The
  squat itself is not fixed.
- Survey (`npm run glitches`, real skins without frames, with the landing change left out): fragments 0, stretch 0
  for all four; pops knight 1, rogue 0, dwarf 1, wizard 0, as before.

### Batch B: the knight's side walk, round 1

Eight hand-drawn frames (`pocs/drawn-walk/`; in `examples/knight/skin.json` as the side view's `walk`): contact, down,
passing and up for each foot, knees bending through them, a 1 px bob, the cape's hem swinging, the plume lagging; the
helmet and a hand-drawn torso reused across frames. The judged strip is the eight frames on their planted sole, which
is what the page shows at walking speed (one frame per slot, none skipped).

- On the page the frames rarely show (0-23% of walking frames on the five layouts): the entry rule needs the frame
  within 20% of the cut-out's silhouette and the drawn walk differs from it by 31-45%, almost all in the bottom rows
  (wider strides, the sword's and the cape hem's positions).
- Knight alone, against the four clothed references (LPC soldier, soldier in its other colours, princess, the male
  body wearing the LPC pants), three judges on three models, both orders: the knight rated 3.05 against the
  references' 3.69 (gate at least equal), picked as software in 20 of 24 answers, 83% (gate at most 60%), rated 2.0 by
  the largest-model judge (gate 3.5). **Missed.** Controls unseparated by 83% of judges; left picks 50%.
- All three judges named the same thing: only the legs change; the torso, helmet and plume stay the same, the cape
  keeps one outline, the sword stays at one angle as if pinned to the hip, the arms do not swing and the torso does
  not turn. The largest also noted the knight's style against the references': thinner outlines, flatter shading, a
  smaller head on a taller body.
