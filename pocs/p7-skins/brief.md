# Brief: draw a character's sprite set in eight directions

You are a pixel artist. Draw small pixel sprites for each body part of one character, as text grids in a JSON file,
for five views; the renderer mirrors three of them for the left-facing directions. It places and rotates the sprites
on a rig that moves by motion capture, so each sprite is drawn once per view, in a fixed orientation. Your only output
is the skin JSON file. Aim for hand-made game pixel art that reads well at 48 px: clean clusters, one-pixel lines, a
consistent light direction (from the upper left of the screen, in every view), deliberate shading and highlights, no noise.

## Your materials

- `guide/` (next to this brief, under the character's folder): for each view, an image of the character's plain 3D
  mannequin at 48 px, scaled 4x (`front.png`, `frontSide.png`, `side.png`, `backSide.png`, `back.png`), and
  `guide.md`, a table per view of every part: its joints, where they sit in the view image (pixels at 48 px, from
  the top-left), the bone's length on screen, how wide the part is across the bone, and where a two-joint sprite's
  top row ends up on screen in that view. Use the images for proportions and silhouette, and the tables for sizes.
- A starting point, if one is given: an existing one-view skin for this character. Keep its palette and style so
  every view looks like the same character; you may improve it.
- The preview command (below). It is the only command you may run. Do not write scripts.

## Views and directions

The skin has five views, each facing as follows (the camera is 14 degrees above the horizon):

| View | The character faces |
|---|---|
| `front` | the viewer |
| `frontSide` | halfway between the viewer and screen-right (its front three-quarter view) |
| `side` | screen-right (its right side toward the viewer) |
| `backSide` | halfway between away and screen-right (its back three-quarter view) |
| `back` | away from the viewer |

The three left-facing directions are drawn by mirroring `frontSide`, `side` and `backSide`, with left and right parts
swapped (the sprite drawn for `thighR` shows as `thighL`, flipped). So in every view, draw the parts as the
character's own left and right: in `side`, the right arm and leg are nearest the viewer; in `front`, the character's
right side is on screen-left.

## How sprites are placed

- 1 sprite pixel = 1 screen pixel. Never scale.
- Two-joint parts (every part with joints A and B in the tables, including box parts like the torso and capes) are
  drawn lying horizontally, the bone pointing along +x from A to B. The renderer turns the sprite to the bone's angle
  on screen (in steps), so the top row ends up on the side the table names ("Top faces"), and it stretches or shrinks
  the middle of the sprite (between the pivots) to the bone's length on screen, keeping the ends: so a limb seen
  end-on or foreshortened stays whole. Draw each view's sprite for how the part looks from that view (the front of a
  thigh, the side of a thigh, a torso's chest or back).
- Single-joint parts (helmets, heads, hands, pauldrons) are not turned: draw them upright as they look in that view.
- Nearer parts are drawn over farther ones, by depth.
- A part whose bone points almost straight at the viewer (its bone under a pixel or two on screen) still shows its
  sprite turned by the bone's angle, which is unsteady: draw such parts as compact blobs that look right at any angle.
- The renderer draws a 1 px outline around the whole silhouette in the darkest palette colour; do not outline the
  outer edges yourself. Where one part overlaps another that it does not join at a joint (an arm over the torso, the
  near leg over the far one), it also draws a line in the next darker shade of the part behind, and it draws the far
  limb of each left and right pair one shade darker. So give overlapping parts different values (not only different
  hues) and include a darker shade for each main colour.

## Drawing helpers

- `"upright": true` on a two-joint sprite: draw it standing, joint A at the top and joint B straight below it
  (`pivotB` in the same column as `pivotA`, further down); the tool turns it to lie along +x for you. Shade it as it
  hangs (for a leg or an arm at rest, that is how it is seen most).
- `"layer": n` (a whole number, default 0): parts on a higher layer are always drawn over parts on a lower one,
  whatever their depth. Use it where the depth order picks the wrong part (a beard over the robe, a hand over a
  handle).
- `"from": "thighR"` or `"from": "side.thighR"`: reuse another sprite (in the same view, or `view.part`) instead of
  copying it; add `"layer"` beside it to change only the layer.

## Pivots

`pivotA` is the pixel `[x, y]` (column, row, 0-based from the top-left) that sits on joint A. For a two-joint part,
`pivotB` is the pixel on joint B: on the same row as `pivotA`, to its right, about the table's bone length away (for
the side view, the true length; in other views the renderer fits the length). A two-joint sprite extends past each
pivot by about half the part's width (rounded ends overlap neighbours at the joints). For a single-joint part,
`pivotA` is the part's centre.

## Palette and format

At most 16 colours shared by all views; one character each, mapped to `"#rrggbb"`; `.` is transparent. Include a very
dark colour for the outline.

```json
{
  "name": "my-knight",
  "palette": { "o": "#1b1421", "s": "#7b8aa8", "h": "#e0e4d6" },
  "views": {
    "front": { "parts": { "forearmR": { "rows": [".hhh.", "sssss"], "pivotA": [1, 1], "pivotB": [3, 1] } } },
    "frontSide": { "parts": { } },
    "side": { "parts": { } },
    "backSide": { "parts": { } },
    "back": { "parts": { } }
  }
}
```

Every view lists every part of the character, either drawn or `{ "hidden": true }` when it cannot be seen in that view
(for example the cape from the front, if the body covers it). Unknown fields are rejected.

## Validate and preview

From the repository root:

```
npm run skin -- preview <character folder> <your skin.json> <output folder>
```

It prints errors with their path (fix them and run again), or writes `directions.png` (the eight directions standing,
starting facing the viewer and turning), `turntable.png` (32 steps of a full turn), `walks.png` (a walk in each of the
eight directions, one row each) and `summary.txt`. Look at every image: each part sits on the body where it should,
limbs join without gaps, the character reads as the same character in every direction, the turn is smooth, and the
walks read well. You may run the preview up to eight times; finish with a skin that validates and covers every part
in every view.
