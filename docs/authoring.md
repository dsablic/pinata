# Character package authoring reference

A character package is a directory of six JSON files that describes a stylised pixel-art character as a posable 3D
mannequin, a palette, a walking rig and a cloth setup. `npm run check` renders the character at 32 px and 48 px,
animates a walk, simulates cloth, measures a fixed set of gates and writes a report. A package is finished when every
gate passes.

## Running the check

```
npm run check -- <character dir> [--out <dir>]
```

| Exit code | Meaning |
|---|---|
| 0 | Package loaded and every gate passed. |
| 1 | Package loaded, at least one gate failed. |
| 2 | Package did not load (format or cross-file error), bad arguments, or an internal error. |

The report is written to `<character dir>/report/` (or `--out`). A run takes a few seconds.

| Report file | Content |
|---|---|
| `summary.txt` | One line per gate, `PASS` or `FAIL  name: value op threshold`, a `hint:` line under each failure, and a final `automated gates: PASS` or `FAIL`. Read this first. |
| `metrics.json` | `{ "gates": [{ name, value, op, threshold, pass, hint? ... }], "timing": {...} }`, the same numbers as the summary. |
| `sheet.png` | Contact sheet, 8x enlarged: four rows (32 px at elevation 0, 32 px at elevation 30, 48 px at elevation 0, 48 px at elevation 30), eight columns (views rotating around the character: front, front-left, left side, back-left, back, back-right, right side, front-right). |
| `walk.png` | Strip of walk frames. |
| `footprints.png` | Foot plant positions over the walk. |
| `cloth.png` | Onion skin of cape and chains. Written only when the character has a cape or chains. |

When the package does not load, the errors are printed and `summary.txt` contains `automated gates: ERROR` plus the
error lines. Image files from an earlier run are not deleted in that case, so ignore stale PNGs when `summary.txt`
says `ERROR`.

Load errors have the form `file: path: message`, for example
`mannequin.json: parts[3].material: material 'steel' has no ramp in style 'bolt'; add materials['steel']`.
All errors are listed at once. Every JSON object rejects unknown fields (`unknown field 'x'; known fields: ...`), so
spell field names exactly as in this guide. JSON allows no comments and no trailing commas.

The `report/` directory is ignored by version control.

## Coordinates and units

| Quantity | Convention |
|---|---|
| Axes | Y is up, Z is forward, X is across. Y = 0 is the floor. |
| Facing | The character faces +Z. Toes point toward +Z, knees bend toward +Z. |
| Sides | The character's left is +X, its right is -X. Left limbs have positive x. |
| Length | Metres. Joint positions are `[x, y, z]` in metres in the rest pose. |
| Rest pose | Standing, feet flat on the floor, arms hanging, centred near x = 0, z = 0. |
| Turning | A positive `degrees` in a turn turns toward +X (the character's left). |
| Mass, time, gravity | kilograms, seconds, m/s^2 (gravity is `[0, -9.81, 0]`). |

`height` in the mannequin is the standing height in metres, from the floor to the top of the highest part. It scales
the model to pixels: the figure is `height` metres tall at 32 px and at 48 px, so one pixel is `height / 32` m in the
small views and `height / 48` m in the large views. The walk gates measure at 48 px.

For a 1.2 m character, one pixel at 32 px is 0.0375 m. Size every feature in pixels, then convert.

## Package layout

```
mychar/
  character.json   manifest
  mannequin.json   joints, body parts, decals
  style.json       lighting, palette, outline
  rig.json         which joints form legs, arms, upper body; gait
  materials.json   cloth and chain physics materials
  motion.json      walk script, cape, chains, wind, simulation settings
```

The manifest may rename any of the five other files with the keys `mannequin`, `style`, `rig`, `materials` and
`motion` (a file name inside the directory). Leave them out to use the default names above.

## character.json

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | non-empty string | yes | Character name, shown in the summary header. |
| `description` | string | no | One-line description. |
| `mannequin`, `style`, `rig`, `materials`, `motion` | file name | no | Override the default file names. |

```json
{ "name": "bolt", "description": "A small boxy robot with round eyes." }
```

## mannequin.json

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | non-empty string | yes | Mannequin name. |
| `height` | number > 0 | yes | Standing height in metres (see Coordinates). |
| `joints` | object | yes | Joint name to `[x, y, z]`, each coordinate finite with absolute value below 1e6. |
| `parts` | array, at least one | yes | The solid shapes that make up the body. |
| `decals` | array | no, default `[]` | Pixel details painted on the surface. |

A joint is a named point in the rest pose. Joints are anchors for parts, decals, cape, chains and the rig. A joint
need not be used by any part.

### Parts

Every part has these fields:

| Field | Type | Meaning |
|---|---|---|
| `name` | non-empty string | Unique among parts. |
| `shape` | `"capsule"` or `"box"` | Required. |
| `a`, `b` | joint names | The two end joints. The part follows them as they move. |
| `material` | string | A key of `materials` in `style.json`. |
| `allowThin` | boolean, default false | Exempts the part from the thin-part gate and draws it in a single colour (the middle ramp colour). Use for blades, antennae, cords. |

**Capsule** (a tube with spherical ends, the workhorse for limbs and heads):

| Field | Type | Meaning |
|---|---|---|
| `radiusA`, `radiusB` | number > 0 | Radius at joint `a` and at joint `b`; tapers between them. |

- `a` and `b` may be the same joint, which gives a sphere (heads, hands, shoulders).
- `abs(radiusA - radiusB)` must be smaller than the distance between the joints, otherwise one end sphere swallows
  the other.

**Box** (a rounded slab, for torsos, hips, plates):

| Field | Type | Meaning |
|---|---|---|
| `width` | number > 0 | Size along `widthAxis`. |
| `thickness` | number > 0 | Size perpendicular to both `widthAxis` and the `a`-`b` direction. |
| `rounding` | number >= 0 | Corner radius. At most half of `min(width, thickness)` and at most half the `a`-`b` length. |
| `widthAxis` | `[x, y, z]`, non-zero | Direction across the part, for example `[1, 0, 0]` for a torso. Must not be nearly parallel to the `a`-`b` direction. |

The box length is the distance from `a` to `b`. `a` and `b` must be different joints.

```json
{ "name": "torso", "shape": "box", "a": "pelvis", "b": "chest", "width": 0.3, "thickness": 0.22,
  "rounding": 0.06, "widthAxis": [1, 0, 0], "material": "shell" },
{ "name": "shinL", "shape": "capsule", "a": "kneeL", "b": "ankleL", "radiusA": 0.05, "radiusB": 0.05,
  "material": "metal" }
```

### Rules for parts

- **Foot capsules.** For each leg in `rig.json` there must be a capsule whose `a` is the leg's `ankle` joint and whose
  `b` is its `toe` joint, in that order. It is the foot. Its radii set the sole height.
- **Sole measurement.** The sole is the lowest point of the foot capsule. In the rest pose both must touch the floor:
  set the ankle joint's y to the foot's `radiusA` and the toe joint's y to its `radiusB`. The toe joint must be in
  front (larger z) of the ankle joint. A foot that does not lie flat makes the ground, slide and hover gates fail.
- **Knees.** Place each knee joint slightly in front (larger z, 0.03 m or more) of the straight line from hip to
  ankle, or the knee bends backwards.
- **Floor.** No part other than the feet may reach below y = 0: every capsule needs joint y >= its radius at that end,
  and every box corner must stay above the floor.
- **Materials.** Each part's `material` must exist in `style.json` `materials`.
- **Names of cloth stand-ins.** A part that only exists to show where a cape or plume hangs must be listed in
  `motion.json` `exclude` (see motion.json).

### Decals

A decal paints a small pixel pattern onto the figure, for eyes, buckles, emblems.

| Field | Type | Meaning |
|---|---|---|
| `name` | non-empty string | Decal name. |
| `anchor` | joint name | Where the pattern is centred. Put the joint on the visible surface of a part. |
| `normal` | `[x, y, z]`, non-zero | Direction the decal faces, out of the surface. |
| `pattern` | array of equal-length strings | One string per pixel row, top row first. `.` is transparent; any other single character is a pixel whose colour comes from `style.json` `decalColors`. |

- The pattern is drawn screen-aligned, centred on the projected anchor, one character per output pixel, at 32 px and
  48 px alike. Keep patterns tiny (1 to 5 characters wide).
- A decal is drawn in a view only when its `normal` faces the camera by at least `decalMinFacing` (style) and its
  anchor is not hidden behind other geometry. It is skipped in the other views.
- Pixels outside every part are not drawn. Decal pixels are exempt from the stray-pixel gate, so single pixels are
  allowed here.
- Every character in a pattern except `.` needs an entry in `decalColors`.

```json
{ "name": "emblem", "anchor": "emblem", "normal": [0, 0, 1], "pattern": [".r.", "rrr", ".r."] }
```

## style.json

| Field | Type | Meaning |
|---|---|---|
| `name` | non-empty string | Style name. |
| `light` | `[x, y, z]`, non-zero | Direction toward the light in camera space (x right, y up, z toward the viewer). `[-0.5, 0.7, 0.5]` is a good default: light from the upper left front. |
| `bands` | numbers in [-1, 1], strictly ascending | Brightness thresholds (dot of surface normal and light). `n` thresholds give `n + 1` shades. `[0.05, 0.6]` gives three shades. |
| `outline` | `#rrggbb` | Silhouette colour. |
| `outlineMode` | `"uniform"` or `"selective"`, default `"uniform"` | `uniform`: every silhouette pixel uses `outline`. `selective`: each silhouette pixel takes the darkest colour of the part it borders, which saves palette colours. |
| `innerLineDepth` | number > 0 | Depth jump in metres between two neighbouring parts that draws a dark line between them. `0.1` to `0.12` typical. |
| `decalMinFacing` | number in [0, 1] | Minimum facing toward the camera for a decal to show. `0.3` typical. |
| `materials` | object, non-empty | Material name to colour ramp: an array of `#rrggbb`, **darkest first**, with exactly `bands.length + 1` colours. |
| `decalColors` | object | Single character (not `.`) to `#rrggbb`. |

Colours are six hex digits with a leading `#`. A part is shaded with its material's ramp; the darkest ramp colour also
draws inner lines. These are the material names that parts refer to; they are separate from the physics materials in
`materials.json`.

```json
{
  "name": "bolt", "light": [-0.5, 0.7, 0.5], "bands": [0.05, 0.6], "outline": "#1b1421",
  "outlineMode": "selective", "innerLineDepth": 0.1, "decalMinFacing": 0.3,
  "materials": { "shell": ["#7a2e1d", "#d9582b", "#ffb36b"] },
  "decalColors": { "e": "#fff176" }
}
```

## rig.json

The rig says how the mannequin moves when it walks.

| Field | Type | Meaning |
|---|---|---|
| `legs` | array of exactly 2 | One `left`, one `right`. |
| `arms` | array | Normally one `left` and one `right`. |
| `pelvis` | joint name | The root joint; the body bobs with it. |
| `upperBody` | array of joint names | Joints that move rigidly with the pelvis: chest, head, decal anchors, cape and chain anchors. |
| `gait` | object | Walk parameters. |

Leg fields: `side` (`"left"` or `"right"`), `hip`, `knee`, `ankle`, `toe` (joint names). Legs use two-bone IK, so the
thigh and shin lengths come from the rest pose and never change.

Arm fields: `side`, `shoulder`, `elbow`, `wrist`, `hand` (joint names), and optional `carried`: joint names that swing
rigidly with the arm, such as the tip of a held sword.

**Rig coverage.** Every joint in the mannequin must appear in exactly one place among: `pelvis`, `upperBody`, a leg's
four joints, an arm's four joints, an arm's `carried`. A joint listed twice, a joint that does not exist, or a joint
that is listed nowhere is an error. Decal anchors, cape anchors and chain anchors are joints too, so list them in
`upperBody` (or `carried`).

### Gait

| Field | Range | Meaning |
|---|---|---|
| `strideLength` | above 0, at most 10 | Metres travelled per full cycle (two steps) at `referenceSpeed`. About 1.4 x leg length. |
| `referenceSpeed` | above 0, at most 20 | m/s at which stride equals `strideLength`. Use the speed in the walk script. |
| `stanceFraction` | 0.5 to 0.8 | Fraction of the cycle a foot is planted. 0.6 typical; keep below 0.7. |
| `stepHeight` | 0 to 2 | Metres of swing-foot lift. Must clearly exceed 0.02. About 0.07 x leg length. |
| `bobAmplitude` | 0 to 1 | Metres of pelvis bob. 0.015 to 0.025 typical. |
| `armSwingDegrees` | 0 to 90 | Arm swing. Left and right arms swing opposite ways. |
| `footSpacing` | 0 to 2 | Metres between left and right foot plants. Use the distance between the hip joints. |
| `strideExponent` | 0.2 to 1, optional, default 0.5 | How fast stride grows with speed. Stride is `strideLength * clamp((speed / referenceSpeed)^strideExponent, 0.5, 1.5)`. |

Leg length is hip y minus ankle y in the rest pose. Starting values: `strideLength` 1.4 x leg length, `footSpacing`
hip distance, `stepHeight` 0.07 x leg length, `stanceFraction` 0.6, `bobAmplitude` 0.015, `armSwingDegrees` 20.

## materials.json

An array of physics materials for cloth and chains. At least one entry. Names must be unique.

| Field | Type | Meaning |
|---|---|---|
| `name` | non-empty string | Referenced by `cape.material` and `chains[].material`. |
| `particleMass` | number > 0 | kg per cloth particle. |
| `stretchCompliance` | number >= 0 | m/N; smaller is stiffer. |
| `bendCompliance` | number >= 0 | m/N; smaller resists folding. |
| `damping` | number >= 0 | 1/s; larger settles faster. |
| `drag` | number >= 0 | N per (m/s); air resistance, how strongly wind pushes. |

Proven starting points:

```json
[
  { "name": "silk", "particleMass": 0.01, "stretchCompliance": 1e-6, "bendCompliance": 1e-3, "damping": 0.3, "drag": 0.02 },
  { "name": "wool", "particleMass": 0.02, "stretchCompliance": 1e-7, "bendCompliance": 1e-4, "damping": 2.4, "drag": 0.015 },
  { "name": "leather", "particleMass": 0.04, "stretchCompliance": 1e-8, "bendCompliance": 1e-5, "damping": 5.0, "drag": 0.01 }
]
```

The file is required even if the character has no cloth; one material is enough.

## motion.json

| Field | Type | Required | Meaning |
|---|---|---|---|
| `script` | object | yes | The walk: see below. |
| `gravity` | `[x, y, z]` | yes | Normally `[0, -9.81, 0]`. |
| `fps` | number above 0, at most 120 | yes | Output frames per second. Use 24. |
| `substeps` | integer 1 to 100 | yes | Cloth solver steps per frame. 20 to 40 usual; more is more stable and slower. |
| `particleRadius` | number > 0 | yes | Cloth particle collision radius in metres. 0.01 to 0.02. |
| `exclude` | array of part names | no, default `[]` | Parts the cloth ignores when colliding. Names must be parts of the mannequin, no duplicates. |
| `cape` | object | no | A cloth sheet hung from two joints. |
| `chains` | array | no, default `[]` | Hanging chains (plumes, tails, antennae, scarves). |
| `wind` | object | no | Constant wind with gusts. |
| `durationSeconds` | number above 0, at most 600 | no | Length of the simulation. Default: script length plus 3 s. |

### script

`{ "accelSeconds": number >= 0, "segments": [...] }`. Segments run in order; each has `action` and `duration` (seconds,
above 0, at most 600):

| Action | Extra fields | Meaning |
|---|---|---|
| `move` | `speed` (m/s, >= 0) | Walk forward at that speed, along the current heading. |
| `turn` | `degrees` (any number) | Change heading smoothly over the duration. Positive turns toward the character's left. |
| `hold` | none | Stand still. |

Speed changes toward each move's target over `accelSeconds`. Rules:

- The **last segment must be a `hold`** and must last **at least `accelSeconds`**, so the motion ends at rest.
- The script must contain a **steady walking window**: a `move` segment with speed above 0 whose time after the first
  `accelSeconds` is not empty and does not overlap a `turn`. The locomotion gates measure only inside these windows.
- A steady window must be long enough for each foot to plant at least twice: one step cycle takes
  `stride / speed` seconds, so make the window (move duration minus `accelSeconds`) at least 2.5 cycles. For a
  stride of 0.6 m at 0.9 m/s, one cycle is 0.67 s and the window should be at least 1.7 s.
- Use the speed `rig.gait.referenceSpeed` for at least one move segment.

```json
"script": {
  "accelSeconds": 0.4,
  "segments": [
    { "action": "move", "speed": 0.9, "duration": 3 },
    { "action": "turn", "degrees": 90, "duration": 1 },
    { "action": "move", "speed": 0.9, "duration": 2 },
    { "action": "hold", "duration": 1 }
  ]
}
```

### cape

A grid of cloth particles hung from two joints and pulled down by gravity.

| Field | Type | Meaning |
|---|---|---|
| `anchorLeft`, `anchorRight` | joint names | Top corners. Must be different joints at different positions, and listed in `rig.upperBody`. Put them on the shoulders or upper back, slightly outside the body so the cloth hangs clear. |
| `columns`, `rows` | integers 2 to 64 | Grid size. 4 to 8 is enough at pixel-art scale. |
| `length` | number > 0 | Cape drop in metres. |
| `material` | string | A name in `materials.json`. |

### chains

Each chain: `anchor` (joint name, listed in the rig), `links` (integer 1 to 64), `linkLength` (metres, above 0),
`direction` (`[x, y, z]`, non-zero, the initial direction the chain points from the anchor), `material` (name in
`materials.json`). Total length is `links * linkLength`.

### wind

`{ "direction": [x, y, z] (non-zero), "speed": m/s >= 0, "gust": number in [0, 1] }`. `gust` is a fraction of `speed`.

### Cloth rules

- A part drawn only as a stand-in for a cape or chain (so you can see it in the views) collides with the cloth that
  represents it; list it in `exclude`.
- Without `cape` and `chains`, the cloth gates are skipped and the summary header says so.

## Gates

Each gate passes when `value op threshold` holds. `summary.txt` gives a hint for every failure; the sections below
say what each gate measures and the usual fix. Static gates look at 32 px and 48 px views, at elevations 0 and 30
degrees, in eight directions (32 views).

### Static gates

| Gate | Passes when | Measures |
|---|---|---|
| `outlineGaps` | = 0 | Silhouette pixels touching the image edge, meaning something is clipped. |
| `maxThinFraction` | <= 0.25 | Worst fraction of a part's pixels that are a single pixel wide. |
| `paletteSize` | <= 16 | Distinct colours over all views. |
| `maxStrayPixels` | <= 2 | Isolated single pixels (not decals) in the worst view. |

- **outlineGaps.** The camera frames the extents of all parts. A part far above or below the figure, or a very large
  outlier, makes this fail. Check that the highest point of any part is close to `height` and the lowest is at y = 0.
- **maxThinFraction.** A part that is one pixel wide flickers and vanishes. At 32 px a part must be at least 2 px
  across, which is `height / 16` metres (0.075 m for a 1.2 m character); aim for 3 px (`3 * height / 32`). For a
  capsule use `2 * radius`; for a box use the smaller of `width` and `thickness`. Parts with fewer than 4 pixels in a
  view are ignored. A part also counts as thin where another part in front covers its sides, so an arm that hangs
  against the torso or a hand hidden behind a thigh fails even if it is wide enough: move limbs outward away from the
  body, or make the end part bigger. For something meant to be a line, set `allowThin: true`.
- **paletteSize.** Every distinct colour counts: ramp colours that appear, decal colours, and the outline colour
  (`selective` mode usually uses fewer). Fix by sharing materials between parts, removing unused ramp colours, using
  two bands instead of three, or using fewer decal colours.
- **maxStrayPixels.** Isolated pixels come from parts smaller than a pixel or mostly hidden behind a neighbour. Make
  them larger, merge them into a neighbouring part, or draw them as a decal.

### Locomotion gates

The walk is simulated with your rig, then measured at 48 px (one pixel is `height / 48` metres).

| Gate | Passes when | Measures |
|---|---|---|
| `footSlidePx` | <= 0.25 | Horizontal movement of a planted foot (its sole within 2 cm of the floor for two frames). |
| `groundPenetrationPx` | <= 0.5 | Deepest the sole goes below y = 0. |
| `partGroundPenetrationPx` | <= 0.5 | Deepest any non-foot part goes below y = 0. |
| `reachViolations` | = 0 | Frames where a foot target was beyond the leg's reach and the leg was clamped straight. |
| `kneeLimitViolations` | = 0 | Frames with knee flexion outside 0 to 150 degrees, or a backward-bending knee. |
| `kneeSpeedDegPerSec` | <= 600 | Peak knee bending speed. |
| `boneLengthError` | <= 0.01 | Relative change of limb bone lengths. |
| `rootSpeedError` | <= 0.05 | Relative difference between foot-measured speed and the script speed in steady windows. |
| `unsupportedFrames` | = 0 | Frames where neither foot is within 2 cm of the floor. |
| `alternationViolations` | = 0 | The same foot planting twice in a row in steady windows. |
| `plantedFrames.left`, `.right` | >= 1 | Each foot is planted at least once. |

Usual fixes:

- **footSlidePx, groundPenetrationPx, plantedFrames, unsupportedFrames.** First check the sole measurement: ankle y
  equals foot `radiusA`, toe y equals foot `radiusB`. The hint prints the actual sole heights at rest; both must be 0.
  If the feet are flat, shorten `strideLength` or `footSpacing`, lower `stepHeight` or `bobAmplitude`.
- **partGroundPenetrationPx.** A part (a dragged sword tip, a low hand, a hem) reaches the floor. Raise its joints in
  the mannequin, or reduce `bobAmplitude` and `armSwingDegrees`.
- **reachViolations.** The stride asks the legs to reach too far. Shorten `strideLength`, `footSpacing` or
  `bobAmplitude`, or lengthen the legs.
- **kneeLimitViolations.** Backward knee: move the knee joint forward (larger z) of the hip-ankle line at rest.
  Overbent knee: lower `stepHeight` or lengthen the legs.
- **kneeSpeedDegPerSec.** Lower `stepHeight`, lower `stanceFraction` (longer, slower swing), or walk slower. Short
  legs with a high step height are the usual cause.
- **boneLengthError.** A joint of a limb is also listed elsewhere (for example in `upperBody` or `carried`), or two
  joints of a limb are at the same position.
- **rootSpeedError.** Feet must plant at least twice inside a steady window. Lengthen the `move` segment (at least
  2.5 cycles after `accelSeconds`) or shorten `strideLength`.
- **alternationViolations.** The swing foot does not rise enough to count as a step: raise `stepHeight` well above
  0.02 m and keep `stanceFraction` below 0.7.

### Cloth gates

Evaluated only when there is a cape or at least one chain.

| Gate | Passes when | Measures |
|---|---|---|
| `nonFinite` | = 0 | Cloth positions that are NaN or infinite (the solver blew up). |
| `maxSpeed` | <= 15 | Fastest cloth particle, m/s. |
| `maxStrain` | <= 0.1 | Largest stretch of a link beyond its rest length (0.1 is 10%). |
| `penetratingFrames` | <= 0.01 | Fraction of frames with cloth deeper than half a pixel at 48 px (`height / 96` metres) inside the body. |

- **nonFinite, maxSpeed, maxStrain.** Raise `substeps` (double it), raise material `damping`, lower
  `stretchCompliance`, lower `particleMass`, or shorten a light cape.
- **penetratingFrames.** If the part the cloth is inside is a stand-in for the cloth, add it to `exclude`. Otherwise
  move the cape anchors outward or lengthen the cape so it hangs clear of the body.

## Complete example

A 1.2 m robot with a chain antenna, written to pass every gate. Create these six files in an empty directory.

### character.json

```json
{
  "name": "bolt",
  "description": "A small boxy robot with round eyes, a chest lamp and a springy antenna, walking, turning and stopping."
}
```

### mannequin.json

```json
{
  "name": "bolt",
  "height": 1.2,
  "joints": {
    "pelvis": [0, 0.52, 0],
    "hipL": [0.08, 0.5, 0],
    "kneeL": [0.08, 0.28, 0.03],
    "ankleL": [0.08, 0.06, 0],
    "toeL": [0.08, 0.04, 0.12],
    "hipR": [-0.08, 0.5, 0],
    "kneeR": [-0.08, 0.28, 0.03],
    "ankleR": [-0.08, 0.06, 0],
    "toeR": [-0.08, 0.04, 0.12],
    "chest": [0, 0.84, 0],
    "chestLamp": [0, 0.72, 0.11],
    "head": [0, 0.98, 0],
    "eyeL": [0.06, 1.0, 0.147],
    "eyeR": [-0.06, 1.0, 0.147],
    "antennaBase": [0, 1.12, 0],
    "antennaTip": [0, 1.19, 0],
    "shoulderL": [0.22, 0.8, 0],
    "elbowL": [0.25, 0.62, 0.02],
    "wristL": [0.26, 0.46, 0.06],
    "handL": [0.26, 0.42, 0.08],
    "shoulderR": [-0.22, 0.8, 0],
    "elbowR": [-0.25, 0.62, 0.02],
    "wristR": [-0.26, 0.46, 0.06],
    "handR": [-0.26, 0.42, 0.08]
  },
  "parts": [
    { "name": "torso", "shape": "box", "a": "pelvis", "b": "chest", "width": 0.3, "thickness": 0.22, "rounding": 0.06, "widthAxis": [1, 0, 0], "material": "shell" },
    { "name": "head", "shape": "capsule", "a": "head", "b": "head", "radiusA": 0.16, "radiusB": 0.16, "material": "shell" },
    { "name": "antenna", "shape": "capsule", "a": "antennaBase", "b": "antennaTip", "radiusA": 0.03, "radiusB": 0.03, "material": "metal", "allowThin": true },
    { "name": "thighL", "shape": "capsule", "a": "hipL", "b": "kneeL", "radiusA": 0.06, "radiusB": 0.05, "material": "metal" },
    { "name": "shinL", "shape": "capsule", "a": "kneeL", "b": "ankleL", "radiusA": 0.05, "radiusB": 0.05, "material": "metal" },
    { "name": "footL", "shape": "capsule", "a": "ankleL", "b": "toeL", "radiusA": 0.06, "radiusB": 0.04, "material": "dark" },
    { "name": "thighR", "shape": "capsule", "a": "hipR", "b": "kneeR", "radiusA": 0.06, "radiusB": 0.05, "material": "metal" },
    { "name": "shinR", "shape": "capsule", "a": "kneeR", "b": "ankleR", "radiusA": 0.05, "radiusB": 0.05, "material": "metal" },
    { "name": "footR", "shape": "capsule", "a": "ankleR", "b": "toeR", "radiusA": 0.06, "radiusB": 0.04, "material": "dark" },
    { "name": "shoulderL", "shape": "capsule", "a": "shoulderL", "b": "shoulderL", "radiusA": 0.07, "radiusB": 0.07, "material": "shell" },
    { "name": "upperArmL", "shape": "capsule", "a": "shoulderL", "b": "elbowL", "radiusA": 0.05, "radiusB": 0.045, "material": "metal" },
    { "name": "forearmL", "shape": "capsule", "a": "elbowL", "b": "wristL", "radiusA": 0.045, "radiusB": 0.045, "material": "metal" },
    { "name": "handL", "shape": "capsule", "a": "handL", "b": "handL", "radiusA": 0.065, "radiusB": 0.065, "material": "dark" },
    { "name": "shoulderR", "shape": "capsule", "a": "shoulderR", "b": "shoulderR", "radiusA": 0.07, "radiusB": 0.07, "material": "shell" },
    { "name": "upperArmR", "shape": "capsule", "a": "shoulderR", "b": "elbowR", "radiusA": 0.05, "radiusB": 0.045, "material": "metal" },
    { "name": "forearmR", "shape": "capsule", "a": "elbowR", "b": "wristR", "radiusA": 0.045, "radiusB": 0.045, "material": "metal" },
    { "name": "handR", "shape": "capsule", "a": "handR", "b": "handR", "radiusA": 0.065, "radiusB": 0.065, "material": "dark" }
  ],
  "decals": [
    { "name": "eyeL", "anchor": "eyeL", "normal": [0.4, 0, 1], "pattern": ["e"] },
    { "name": "eyeR", "anchor": "eyeR", "normal": [-0.4, 0, 1], "pattern": ["e"] },
    { "name": "lamp", "anchor": "chestLamp", "normal": [0, 0, 1], "pattern": ["l"] }
  ]
}
```

### style.json

```json
{
  "name": "bolt",
  "light": [-0.5, 0.7, 0.5],
  "bands": [0.05, 0.6],
  "outline": "#1b1421",
  "outlineMode": "selective",
  "innerLineDepth": 0.1,
  "decalMinFacing": 0.3,
  "materials": {
    "shell": ["#7a2e1d", "#d9582b", "#ffb36b"],
    "metal": ["#3b4256", "#8592ad", "#dde4ee"],
    "dark": ["#1f2230", "#454b63", "#79819c"]
  },
  "decalColors": { "e": "#fff176", "l": "#7cf0c8" }
}
```

### rig.json

```json
{
  "legs": [
    { "side": "left", "hip": "hipL", "knee": "kneeL", "ankle": "ankleL", "toe": "toeL" },
    { "side": "right", "hip": "hipR", "knee": "kneeR", "ankle": "ankleR", "toe": "toeR" }
  ],
  "arms": [
    { "side": "left", "shoulder": "shoulderL", "elbow": "elbowL", "wrist": "wristL", "hand": "handL" },
    { "side": "right", "shoulder": "shoulderR", "elbow": "elbowR", "wrist": "wristR", "hand": "handR" }
  ],
  "pelvis": "pelvis",
  "upperBody": ["chest", "chestLamp", "head", "eyeL", "eyeR", "antennaBase", "antennaTip"],
  "gait": {
    "strideLength": 0.6,
    "referenceSpeed": 0.9,
    "stanceFraction": 0.6,
    "stepHeight": 0.05,
    "bobAmplitude": 0.015,
    "armSwingDegrees": 20,
    "footSpacing": 0.16
  }
}
```

### materials.json

```json
[
  { "name": "cord", "particleMass": 0.02, "stretchCompliance": 1e-7, "bendCompliance": 1e-4, "damping": 2.4, "drag": 0.015 }
]
```

### motion.json

```json
{
  "exclude": ["antenna"],
  "script": {
    "accelSeconds": 0.4,
    "segments": [
      { "action": "move", "speed": 0.9, "duration": 3 },
      { "action": "turn", "degrees": 90, "duration": 1 },
      { "action": "move", "speed": 0.9, "duration": 2 },
      { "action": "hold", "duration": 1 }
    ]
  },
  "chains": [
    { "anchor": "antennaBase", "links": 4, "linkLength": 0.03, "direction": [0, 1, 0], "material": "cord" }
  ],
  "gravity": [0, -9.81, 0],
  "fps": 24,
  "substeps": 40,
  "particleRadius": 0.01
}
```

Result of `npm run check -- <dir>`:

```
check: bolt (<dir>)
PASS  outlineGaps: 0 <= 0
PASS  maxThinFraction: 0.200 <= 0.25
PASS  paletteSize: 11 <= 16
PASS  maxStrayPixels: 2 <= 2
PASS  footSlidePx: 0.081 <= 0.25
PASS  groundPenetrationPx: 0.000 <= 0.5
PASS  partGroundPenetrationPx: 0 <= 0.5
PASS  reachViolations: 0 <= 0
PASS  kneeLimitViolations: 0 <= 0
PASS  kneeSpeedDegPerSec: 552.803 <= 600
PASS  boneLengthError: 0.000 <= 0.01
PASS  rootSpeedError: 0.015 <= 0.05
PASS  unsupportedFrames: 0 <= 0
PASS  alternationViolations: 0 <= 0
PASS  plantedFrames.left: 186 >= 1
PASS  plantedFrames.right: 176 >= 1
PASS  nonFinite: 0 <= 0
PASS  maxSpeed: 2.670 <= 15
PASS  maxStrain: 0.067 <= 0.1
PASS  penetratingFrames: 0 <= 0.01
automated gates: PASS
```

Things this example shows: the feet are capsules from ankle to toe with the ankle at the foot's `radiusA` height
(0.06) and the toe at `radiusB` height (0.04); knees sit 0.03 m in front of the hip-ankle line; every joint
(including eye, lamp and antenna joints) is listed exactly once in the rig; the thin `antenna` part has
`allowThin: true` and is listed in `exclude` because the chain represents it; hands are larger than the forearms and
the arms hang away from the torso so they are not hidden in side views.

## Working loop

1. Write the six files. Start from the example and change shapes, colours and proportions.
2. Run `npm run check -- <dir>`. Exit code 2 means a load error: fix the lines in `summary.txt`.
3. On exit code 1, work through the `FAIL` lines and their hints from top to bottom. Static gates first: they change
   the mannequin that the walk gates measure.
4. Look at `sheet.png` (shape and palette), `walk.png` and `footprints.png` (feet), `cloth.png` (cape and chains).
5. Re-run until `automated gates: PASS`.
