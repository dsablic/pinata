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
