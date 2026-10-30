# Brief: draw the knight's sprite set

You are a pixel artist. Draw a small pixel sprite for each body part of one character, as text grids in a JSON file.
A renderer places and rotates the sprites on a rig and animates them, so every sprite is drawn once, in a fixed
orientation. Your only output is the skin JSON file. Aim for hand-made pixel art that reads well at 48 px, not for
realism: clean clusters, a consistent light direction, deliberate shading and highlights.

## The character and the view

An armoured knight: steel helmet with a visor slit and a red plume, steel torso with a gold buckle and a red emblem on
the chest, leather hips, dark-steel arms and legs, steel pauldrons, leather gloves and boots, a red cape hanging from
the shoulders, and a sword in the right hand. The knight is 48 px tall and seen from the side, facing screen-right,
with the camera at his right side: his right arm and leg are nearest the viewer, and nearer parts are drawn over
farther ones. Light comes from the upper left front. The knight stands and walks, so limbs swing about 40 degrees
either way; draw them so they still read when rotated.

## Scale and orientation

- 1 sprite pixel = 1 screen pixel. Never scale; the sizes below are final.
- Draw every two-joint part lying horizontally, with its bone pointing along +x (to the right) from joint A to joint B.
  The renderer rotates it to the bone's on-screen angle, snapped to 22.5 degree steps, with nearest-neighbour
  sampling (no smoothing).
- The top of the sprite ends up on the left-hand side as you travel from A to B on screen. Legs and arms hang down, so
  there the top of the sprite becomes the front of the knight (screen-right). The torso points up, so there the top
  becomes the back (screen-left). The plume points back (left), so its top becomes the underside. The sword points
  down-forward, so its top ends up on the upper-right side. The cape hangs down, so its top is the front (the side
  towards the body). The foot points forward already, so its top stays on top.
- Single-joint parts (helmet, pauldrons, hands) are not rotated: draw them upright as they appear on screen.
- Left and right parts are separate entries; they may be identical copies. The left side is the far side, so
  shading the left limbs a step darker is welcome.

## Pivots

`pivotA` is the pixel `[x, y]` (column, row, from the top-left corner, 0-based) that sits on joint A; `pivotB` is the
pixel at joint B and must be on the same row as `pivotA` and to its right. Joints are the centres of the rounded
ends, so a limb sprite extends past each pivot by about the end radius. For a single-joint part only `pivotA`
matters (the centre of the part). The distance between the pivots should match the "bone" length below (a difference
of 2 px or more is reported by the validator). Neighbouring parts overlap at the joints, so make the ends round
or overlap-friendly.

## Parts

Sizes in screen pixels at 48 px. "bone" is the pivot-to-pivot distance, "overall" the sprite length including end
caps, "width" the thickness across the bone (two numbers: at A and at B). Part names are exact.

| Part | Joints A -> B | Bone | Overall | Width | Sprite top ends up |
|---|---|---|---|---|---|
| helmet | head (single) | - | 14.4 | 14.4 | upright |
| plume | plumeFront -> plumeBack | 8.8 | 12.0 | 3.7 -> 2.7 | below (points back and slightly up) |
| torso | pelvis -> chest | 10.7 | 10.7 | 8.5 | back |
| hips | hipsBottom -> pelvis | 4.3 | 4.3 | 8.0 | back |
| capeL, capeR | capeTop -> capeHem | 22.9 | 22.9 | 5.1 | front |
| thighL | hipL -> kneeL | 9.6 | 15.2 | 5.9 -> 5.3 | front |
| shinL | kneeL -> ankleL | 9.1 | 14.0 | 5.3 -> 4.5 | front |
| footL | ankleL -> toeL | 4.3 | 8.8 | 4.8 -> 4.3 | top |
| thighR | hipR -> kneeR | 9.4 | 15.0 | 5.9 -> 5.3 | front |
| shinR | kneeR -> ankleR | 9.6 | 14.6 | 5.3 -> 4.5 | front |
| footR | ankleR -> toeR | 4.1 | 8.6 | 4.8 -> 4.3 | top |
| pauldronL, pauldronR | shoulder (single) | - | 6.9 | 6.9 | upright |
| upperArmL | shoulderL -> elbowL | 6.2 | 11.6 | 5.6 -> 5.1 | front |
| forearmL | elbowL -> wristL | 5.8 | 10.1 | 4.5 -> 4.0 | front |
| handL | handL (single) | - | 5.3 | 5.3 | upright |
| upperArmR | shoulderR -> elbowR | 6.5 | 11.8 | 5.6 -> 5.1 | front |
| forearmR | elbowR -> wristR | 5.9 | 10.2 | 4.5 -> 4.0 | front |
| handR | handR (single) | - | 5.3 | 5.3 | upright |
| sword | handR -> swordTip | 17.4 | 19.1 | 1.9 -> 1.6 | upper-right |

The torso is only 8.5 px deep in this view and the legs are short: the character is chunky. You may draw slightly
larger than the table where a design needs it (a plume crest, a helmet brim, a cape flare), by a pixel or two, but
keep the pivots right. Cape: capeL and capeR hang from the shoulders behind the knight; give them a darker red inner
fold so two overlapping capes still read. The sword's hilt is at pivot A (in the hand), the blade runs to B.
Parts of the knight that can be left out may be marked `"hidden": true` (for example one cape if you merge them).
Every part must have an entry or be hidden.

## Palette

- At most 16 colours in total, shared by all sprites. Each is one character mapped to `"#rrggbb"`.
- `.` is transparent and cannot be a palette key. Use single characters such as letters or digits.
- The renderer draws a 1 px outline around the whole silhouette using the darkest palette colour, so include a very
  dark colour for that (for example `#1b1421`), and do not outline the sprites' outer edges yourself. Inside the
  silhouette you may use dark colours as inner lines.
- Every character in `rows` must be `.` or in the palette. No colour is ever blended or created by the renderer.

## JSON format

```json
{
  "name": "my-knight",
  "view": "side-right",
  "palette": { "o": "#1b1421", "s": "#7b8aa8", "h": "#e0e4d6" },
  "parts": {
    "forearmR": {
      "rows": [
        ".hhhhhh.",
        "sssssss.",
        ".sssss.."
      ],
      "pivotA": [2, 1],
      "pivotB": [6, 1]
    },
    "capeL": { "hidden": true }
  }
}
```

`rows` are strings of equal length (at most 64 x 64), one per pixel row. `view` is always `"side-right"`. Unknown fields
are rejected.

## Validate and preview

Save your skin as a JSON file and run, from the repository root:

```
npm run skins -- path/to/skin.json
```

Exit code 2 means errors (printed with the path to the problem; fix them and run again). Exit code 0 writes
`reports/skins/stand.png` (standing pose), `walk-strip.png` (8 consecutive walk frames), `preview.png` (both at 8x)
and `summary.txt`. Open `reports/skins/preview.png` and check that every part sits on the body where it should, that
limbs join at the joints without gaps, and that the walk reads well. Adjust pivots and sprites and rerun. You have
three attempts at a skin that validates and covers every part.
