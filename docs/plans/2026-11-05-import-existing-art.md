# Import Existing Art

Every character so far was drawn for Piñata, in its skin format. A user often has art already: a sprite someone drew,
in one pose per direction. This plan takes existing CC pixel-art characters through the tool (cut into parts, the
hidden areas drawn, rigged, animated with walk, idle, jump and a cape, exported) and judges the result. Hand-animated
sheets of the same art (LPC walks) make the cleanest motion comparison yet: the art is equal, only the motion differs.

## Design

- **`pinata import`.** Input: one image per available direction (a standing frame) and points marked on it (joints:
  hips, knees, ankles, toes, shoulders, elbows, wrists, neck, head; free names allowed, as in the
  [image-and-points](2026-10-30-image-points.md) model). Output: a character folder (rig fitted to the points,
  retarget, a five-view `skin.json` whose part sprites are cut from the image along the bones). The points can be
  proposed by an agent and corrected; the cut is deterministic given the points.
- **Hidden areas.** A cut leaves holes (the torso under the arm, the far leg behind the near one). `import` marks them
  and lists them; the author (an agent) draws them, guided by `check`. Views the source lacks (the three-quarter
  views of a four-direction set) are drawn by the author from the neighbouring views; `import` starts each from the
  nearer cardinal view and says so.
- **The skins path, not a mesh warp.** Imported art becomes part sprites in the existing renderer, so the export,
  every gate, `check`, `review` and the MCP server work unchanged. The image-and-points mesh warp stays a separate
  plan.
- **Sources and licences.** LPC characters (CC-BY-SA/GPL) stay outside the repository, as the calibration control
  does, and are used for the motion comparison; one CC0 character (OpenGameArt CC0 or a CC0 tileset) may be committed
  as an import example with its licence noted.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Import round trip | the imported character's standing frame in each source direction, drawn by the renderer at rest, differs from the source frame in at most 2% of its opaque pixels | the cut and the rig lose nothing visible |
| Every export gate | each imported character exports with every author gate passing | as the examples |
| Directions | the facing-readability gates on the imported characters (idle 90%, each direction 2 of 3, walk 80%) | the views the source lacks are included |
| Motion against hand animation | a blind pairwise panel, same art: Piñata's walk strip against the LPC hand-animated walk strip, per character and direction, both orders, with controls; Piñata's walk is preferred or tied in at least 40% of answers | the first measure of motion alone; 40% means close to hand animation, not better |
| A fresh agent imports | a fresh agent with only the guide and the MCP server imports one LPC character to a passing export within 10 `check` runs | as the exit test |
| Existing outputs | byte-identical | import adds a path |

## Batches

- **A. Import:** points, the cut, the rig fit, the hidden-area list, the round-trip gate, on two LPC characters and
  one CC0 character. Review.
- **B. Animate:** hidden areas and missing views drawn, a cape, the export gates and the direction gates. Review.
- **C. Judged:** the pairwise panel against the LPC hand-animated walks; the fresh-agent import. Review.

Order: after [facing readability](2026-11-05-facing-readability.md) batch B, so imported characters meet the
direction checks.
