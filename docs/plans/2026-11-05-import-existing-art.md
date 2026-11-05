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
- **One view is enough.** The usual input is a single image (a front or side view, from a CC set or an image
  model). `import` fits the rig to it and renders a view guide for each of the five views: the fitted rig posed at
  rest in that view, each part's region at its projected place and size, filled with the source part's colours. The
  AI author paints each missing view over its guide instead of inventing it; the direction checks and `pinata
  review` catch views that do not read.
- **Hidden areas.** A cut leaves holes (the torso under the arm, the far leg behind the near one). `import` marks them
  and lists them; the author (an agent) draws them, guided by `check`. Views the source lacks (the three-quarter
  views of a four-direction set) are drawn by the author from the neighbouring views; `import` starts each from the
  nearer cardinal view and says so.
- **Art from people or from image models alike.** Image-model output is rarely clean pixel art: it is upscaled off
  the pixel grid, anti-aliased, noisy in colour, on an opaque or checkered background, and its views of one character
  disagree. `import` normalises every input the same way and reports what it did: the background removed, the pixel
  grid found and the image reduced to one pixel per art pixel, the palette reduced to the art's colours (a stated
  limit), stray pixels cleaned. Views that disagree (proportions, colours, details) are reported, not silently
  merged; the author redraws them over the view guides.
- **Not only sprites.** The input may be any character image: a high-resolution illustration, a painting, vector art,
  a 3D render. When `import` finds no pixel grid, it converts the image to pixel art at a chosen character height
  (48 px by default) with a palette budget and an outline, says so, and the author cleans the result up as part of
  the skin; a sprite input skips this step.
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
| From one view | a fresh agent given only the front standing frame of an LPC character reaches a passing export and the direction gates (idle 90%) | the views drawn over the guides |
| Image-model input | an image-model character (CC0, upscaled off-grid, with a background) is normalised to its pixel grid and palette and imported to a passing export; on a clean sprite deliberately upscaled 3x with blur and a background, normalisation recovers the original exactly or within 1% of its pixels | the same tool for both sources |
| Not a sprite | a CC0 high-resolution character illustration imports to pixel art at 48 px and a passing export; a blind choice panel matches the pixel-art idle frame to its source illustration among four illustrations in at least 90% of answers | the character survives the conversion |
| Existing outputs | byte-identical | import adds a path |

## Batches

- **A. Import:** normalisation, points, the cut, the rig fit, the hidden-area list, the view guides, the round-trip
  gate, on two LPC characters, one CC0 character, one image-model character and one
  illustration. Review.
- **B. Animate:** hidden areas and missing views drawn, a cape, the export gates and the direction gates. Review.
- **C. Judged:** the pairwise panel against the LPC hand-animated walks; the fresh-agent import, from all views and
  from one view. Review.

Order: after [facing readability](2026-11-05-facing-readability.md) batch B, so imported characters meet the
direction checks.
