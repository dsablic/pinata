# Drawn walk frames: the knight's side walk

Eight whole-body frames of the knight walking right, at the page's sprite scale, for
[the drawn walk frames plan](../../docs/plans/done/2026-11-03-drawn-walk-frames.md), batch B. Judged twice and not
kept (see the plan).

- `knight-side-walk.json`: the frames (palette keys of `examples/knight/skin.json`), each with `soles` (the ground pixel
  under the near and the far foot) and `planted` (0 near, 1 far). The planted sole steps back 3 px a frame, so a
  cycle is 24 px.
- `knight-side-walk-preview.png`: the eight frames at 4x.
- `compose.py`: how the first pass was laid out: contact, down, passing and up poses for each foot, a 1 px bob, the
  cape's swing and the plume's lag drawn per frame, the helmet from the knight's own side view and a hand-drawn torso;
  run as `python3 compose.py <guide.txt> <out.json>` with a guide exported from the page's cut-out walk.
