# Character authoring guide

A character is a directory of JSON files: six that describe a stylised pixel-art character as a posable 3D mannequin,
a palette, a walking rig and a cloth setup, and two more (`retarget.json`, `skin.json`) for a drawn, animated,
exported character. This guide covers one character from first file to exported sprite sheets: the package files, the
skin you draw, and the commands that check, preview and export it. It needs nothing but this document and the
`pinata` command or its MCP server.

## The tools

`pinata` is one command. Run it with `npx pinata <command>` (inside a project that has the package installed) or as
`pinata <command>`; `pinata help` lists the commands. It needs Node 24 or later.

| Command | Does | Writes |
|---|---|---|
| `pinata new --template <biped\|quadruped\|hexapod\|octopod> <dir>` | A starter package that passes `check` | the six files |
| `pinata check <dir> [--out <dir>]` | The gates on the mannequin, rig and cloth, with hints | `summary.txt`, `metrics.json`, `sheet.png`, `walk.png`, `footprints.png`, `cloth.png` |
| `pinata skin guide <dir> <out>` | Where each part sits in each of the five views, to draw against | `guide.md` and `front.png`, `frontSide.png`, `side.png`, `backSide.png`, `back.png` |
| `pinata skin preview <dir> <skin.json> <out> [--clean]` | Validates the skin and draws it | `directions.png`, `turntable.png`, `walks.png`, `summary.txt` |
| `pinata skin fit <dir> [<skin.json>]` | Flags sprites whose length does not suit their bone | printed lines only |
| `pinata render <dir> <out>` | A skinned character's idle in eight directions and walk, crouch and attack strips, for looking | `idle-directions.png`, `walk-strip.png`, `crouch-strip.png`, `attack-strip.png` |
| `pinata export <dir> <out> [--full]` | Idle (a captured standing take, looped), walk, run, turn, jump, crouch and attack, each in eight directions | per animation `<name>-<animation>.png` (sprite sheet), `.json` (Aseprite JSON array format: frames, durations, tags `<animation>-<direction>`, the anchor as a slice pivot) and `.aseprite` (Aseprite's binary format) |

Exit codes: 0 ok; 1 a gate failed whose fix is in the character's files (a `hint:` line says which file and what to
change); 2 bad arguments, a package that does not load, or a character the command cannot work on (`render` and
`export` need `skin.json` and `retarget.json`).

`export` prints every `FAIL` line with its hint (a repeated hint is `as above`), then the passing and the engine-note
checks as counts per gate; `--full` (`full: true` over MCP) lists every track. `note` lines are engine notes: gates that
measure the engine (planted feet in the drawn frames, the view drawn per direction, the cell border, the anchor), which
no character file can fix and which do not change the exit code. `FAIL` lines are about the character: `ground` and
`drawn` mean a foot is drawn off its ground point or not drawn (`skin.json`, see The ground gate), `loop` means the end
of a cycle does not match its start (the cloth in `motion.json`, or the gait in `rig.json`).

`pinata mcp` serves the same commands to an agent over the Model Context Protocol (stdio, newline-delimited
JSON-RPC). Register it in a client as the command `npx pinata mcp` (in Claude Code: `claude mcp add pinata -- npx
pinata mcp`); from a checkout it is `node src/cli/pinata.ts mcp`. It offers:

- one tool per command, `new`, `check`, `skin`, `render` and `export`, with the command's arguments as a JSON object
  (`dir`, `out`, `template`, `full`; `skin` also takes `action` of `guide`, `preview` or `fit`). Unknown arguments and
  wrong types are refused with an error result naming the argument. Relative paths resolve against the server's working
  directory, so pass absolute paths. The result is the command's lines, the files it wrote and `exit status: n`;
  `isError` is true for any non-zero status, a failed gate included: read it and fix the named file;
- this guide as the resource `pinata://docs/authoring`.

Edit files by writing the whole file with your file-writing tool, not with `sed` or `awk` (`sed -i` differs between
macOS and Linux and can fail silently). JSON allows no comments and no trailing commas.

## From prompt to export

1. `pinata new --template biped <dir>` (a humanoid with the joint names the motion capture needs: see Skin, motion and
   export) and change shapes, colours and proportions to the character. For a four-legged character use `quadruped`,
   and so on (a skinned export is humanoid only).
2. A cape, cloak or scarf is cloth: declare it in `motion.json` (`cape`, `chains`, `bind`; see Cape and cloth in a
   skinned character) before drawing anything. The skin only draws what the simulation moves; a cape drawn as an
   ordinary skin part, or coloured into the torso, never swings.
3. `pinata check <dir>`. Exit 2: a load error, fix the lines in `summary.txt`. A `skin.json` that does not read
   (not JSON, the wrong form, a pivot outside its sprite) is a load error too, printed as `skin.json: ...` lines,
   whether or not `retarget.json` exists yet. Exit 1: work through the `FAIL` lines and hints from the top.
   Static gates first: they change the mannequin that the walk gates measure. Then look at
   `sheet.png` (shape and palette), `walk.png` and `footprints.png` (feet) and `cloth.png` (cape and chains). Repeat
   until `automated gates: PASS`. Once `skin.json` and `retarget.json` exist, `check` also draws the idle in eight
   directions and fails `idleFootMisses` for the `export` gates `ground` and `drawn`; only `export` runs the others.
4. Add `retarget.json` and draw `skin.json` (Skin, motion and export), using `pinata skin guide`, `skin preview` and
   `skin fit`.
5. `pinata render <dir> <out>`: look at the idle in eight directions and the walk, crouch and attack strips.
6. `pinata export <dir> <out>`: fix any `FAIL` line; the sheets are the result.

## `pinata check`

```
pinata check <character dir> [--out <dir>]
```

It renders the character at 32 px and 48 px, animates a walk, simulates cloth, measures a fixed set of gates and
writes a report. A package is finished when every gate passes.

Exit codes are the command's: 0 every gate passed, 1 a gate failed, 2 the package did not load (format or cross-file
error), bad arguments (including a file instead of a directory) or an internal error.

The report is written to `<character dir>/report/` (or `--out`). A run takes a few seconds.

| Report file | Content |
|---|---|
| `summary.txt` | One line per gate, `PASS` or `FAIL  name: value op threshold`, a `hint:` line under each failure, and a final `automated gates: PASS` or `FAIL`. Read this first. |
| `metrics.json` | `{ "gates": [{ name, value, op, threshold, pass, hint? ... }], "timing": {...} }`, the same numbers as the summary. |
| `sheet.png` | Contact sheet, 8x enlarged: four rows (32 px at elevation 0, 32 px at elevation 30, 48 px at elevation 0, 48 px at elevation 30), eight columns (views rotating around the character: front, front-left, left side, back-left, back, back-right, right side, front-right). Chains and the cape are drawn in when they have a `render` entry, as they hang in the middle of the first steady walk, so a mane, tail or streamer shows where it settles while the character moves. |
| `walk.png` | Strip of walk frames. Chains and the cape are drawn into it when they have a `render` entry (see motion.json). |
| `footprints.png` | Foot plant positions over the walk. |
| `cloth.png` | Onion skin of cape and chains. Written only when the character has a cape or chains. |

Every run first deletes the report files of the previous run, so everything in the report directory comes from the
current run. When the package does not load, the errors are printed and `summary.txt` contains
`automated gates: ERROR` plus the error lines; no `metrics.json` or images are written.

Load errors have the form `file: path: message`, for example
`mannequin.json: parts[3].material: material 'steel' has no ramp in style 'bolt'; add materials['steel']`.
All errors found are listed at once, but cross-file errors (a name that refers to another file, rig coverage, cape
anchors, `height` against the parts) are only checked after every file is valid on its own, so a second batch of
errors can appear once the first is fixed. Every JSON object rejects unknown fields
(`unknown field 'x'; known fields: ...`), so spell field names exactly as in this guide. JSON allows no comments and
no trailing commas.

## Coordinates and units

| Quantity | Convention |
|---|---|
| Axes | Y is up, Z is forward, X is across. Y = 0 is the floor. |
| Facing | The character faces +Z. Toes point toward +Z, knees bend toward +Z (toward -Z for a leg with `bend: "backward"`, up with `"up"`). |
| Sides | The character's left is +X, its right is -X. Left limbs have positive x. |
| Length | Metres. Joint positions are `[x, y, z]` in metres in the rest pose. |
| Rest pose | Standing, feet flat on the floor, arms hanging, centred near x = 0, z = 0. |
| Turning | A positive `degrees` in a turn turns toward +X (the character's left). |
| Mass, time, gravity | kilograms, seconds, m/s^2 (gravity is `[0, -9.81, 0]`). |

`height` in the mannequin is the standing height in metres, from the floor to the top of the highest part. It is
validated: it is an error when it differs by more than 10% from the span between the lowest sole point and the top of
the highest part at rest (the message prints both numbers). It scales the model to pixels: the figure is `height`
metres tall at 32 px and at 48 px, so one pixel is `height / 32` m in the small views and `height / 48` m in the
large views. The walk gates measure at 48 px.

## Package layout

```
mychar/
  character.json   manifest
  mannequin.json   joints, body parts, decals
  style.json       lighting, palette, outline
  rig.json         which joints form legs, arms, appendages, upper body; gait
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
| `height` | number > 0 | yes | Standing height in metres: the span from the lowest sole point to the top of the highest part, within 10% (see Coordinates). |
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
- **Sole measurement.** The two sole points of a foot are `ankle.y - radiusA` and `toe.y - radiusB`. What matters is
  that the foot is level: these two must be equal. Their absolute height does not matter, because the gait grounds the
  lowest sole point on the floor. The toe joint must be in front (larger z) of the ankle joint. A tilted foot rolls
  while it is planted and makes the slide and ground gates fail.
- **Knees.** Knees bend forward, or backward for a leg with `bend: "backward"` (the IK solver decides the direction).
  The rest position of the knee joint only sets the thigh length (hip to knee) and the shin length (knee to ankle); it
  does not choose which way the knee bends. The two joints of a bone (hip and knee, knee and ankle, ankle and toe,
  shoulder and elbow, elbow and wrist) must not be at the same position: that is a load error.
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
| `anchor` | joint name | Where the pattern is centred. Put the joint on the front surface of a part, facing `normal`. |
| `normal` | `[x, y, z]`, non-zero | Direction the decal faces, out of the surface. |
| `pattern` | array of equal-length strings | One string per pixel row, top row first. `.` is transparent; any other single character is a pixel whose colour comes from `style.json` `decalColors`. |

- The pattern is drawn screen-aligned, centred on the projected anchor, one character per output pixel, at 32 px and
  48 px alike. Keep patterns tiny (1 to 5 characters wide).
- A decal is drawn in a view only when its `normal` faces the camera by at least `decalMinFacing` (style) and its
  anchor is not hidden behind other geometry. It is skipped in the other views.
- The anchor must sit on the front surface, within about one pixel (`height / size` m: 0.0375 m at 32 px for a 1.2 m
  character) behind it. An anchor deeper inside a part counts as hidden and the decal never shows. For a part of
  radius `r` centred on the axis, put the anchor `r` in front of the axis.
- Pixels outside every part are not drawn. Decal pixels are exempt from the stray-pixel gate. Every character in a
  pattern except `.` needs an entry in `decalColors`.

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
| `outlineMode` | `"uniform"` or `"selective"`, optional, default `"uniform"` | `uniform`: every silhouette pixel uses `outline`. `selective`: each silhouette pixel takes the darkest colour of the part it borders, which saves palette colours. |
| `innerLineDepth` | number > 0 | Depth jump in metres between two neighbouring parts that draws a dark line between them. `0.1` to `0.12` typical. |
| `decalMinFacing` | number in [0, 1] | Minimum facing toward the camera for a decal to show. `0.3` typical. |
| `materials` | object, non-empty | Material name to colour ramp: an array of `#rrggbb`, **darkest first**, with exactly `bands.length + 1` colours. |
| `decalColors` | object | Single character (not `.`) to `#rrggbb`. |

Every field is required except `outlineMode`; `decalColors` may be `{}` when there are no decals. Colours are six hex
digits with a leading `#`. A part is shaded with its material's ramp; the darkest ramp colour also
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

The rig says how the mannequin moves when it walks: which joints form legs, arms and appendages (tails, ears,
antennae, wings), which move rigidly with the body, and the gait.

| Field | Type | Meaning |
|---|---|---|
| `template` | `"biped"`, `"quadruped"`, `"hexapod"` or `"octopod"`, optional | Fills in leg phases, bends and some gait values (see Templates). Explicit fields always win. |
| `limbs` | array | Every leg, arm and appendage (see Limbs). At least one leg; as many left as right legs. |
| `pelvis` | joint name | The root joint; the body bobs with it. |
| `upperBody` | array of joint names | Joints that move rigidly with the pelvis: chest, head, decal anchors, cape and chain anchors. |
| `attached` | object, optional | Joints that move rigidly with another joint, as `{ "joint": "parent joint" }`: a badge on a forearm, a feather on a leg, a decal anchor on a tail tip. The parent can be any joint, including another attached joint; chains must end at the pelvis. |
| `gait` | object | Walk parameters. |

`limbs`, `pelvis`, `upperBody` and `gait` are required. Start a new package with
`pinata new --template <name> <dir>`: it writes a minimal package for the template that passes `check`.

The older format, with `legs` and `arms` lists of `{ side, hip, knee, ankle, toe, phase, bend }` and
`{ side, shoulder, elbow, wrist, hand, carried }`, still loads (the complete example below and most examples use it);
it is translated to `limbs`. A rig uses one format or the other, not both. The older format has 4-joint legs and arms
only, with `bend` `"forward"` or `"backward"`: for appendages, longer legs, bend arrays, `"up"` or `limits`, write
`limbs`.

**Rig coverage.** Every joint in the mannequin must appear in exactly one place among: `pelvis`, `upperBody`,
`attached`, a limb's `joints`, an arm's `carried`. A joint listed twice, a joint that does not exist, or a joint that
is listed nowhere is an error. Decal anchors, cape anchors and chain anchors are joints too, so list them in
`upperBody`, `attached` or `carried`. Together these form a hierarchy: every joint has a parent (the pelvis for
`upperBody` and for the first joint of legs and arms, the previous joint along a limb, the last arm joint for
`carried`, the named joint for `attached` and for an appendage's `parent`), and a joint that nothing else moves
follows its parent's position and rotation. A limb joint turns with the bone that leaves it, the last joint of a limb
with the bone that arrives (a joint attached to a knee stays on the shin, one attached to a toe stays on the foot).
Cloth and chains pinned to a joint turn with it too. Cape anchors must
still move with the body as one piece: `upperBody`, or attached joints whose parents lead to the pelvis through
`upperBody` only.

### Limbs

Each limb has a `kind`, a `joints` list and an optional `name` (default `leg1`, `arm1`, `appendage1`, ... counting
limbs of that kind, skipping a name another limb already uses; names must be unique and appear in hints).

| Kind | Joints | Fields |
|---|---|---|
| `leg` | 4 or more, from the hip to the toe: hip, one or more bending joints, ankle, toe | `side`; `phase`, `bend`, `limits` |
| `arm` | 2 or more, from the shoulder outward | `side`; `carried` |
| `appendage` | 2 or more, from the root outward | optional `side`; `stiffness`, `damping`, `oscillate` |

**Legs.** The last two joints are the foot (a capsule part must span the ankle and the toe). The gait plans where
the foot goes and inverse kinematics places the chain, so every leg bone keeps its rest length. A 4-joint leg (hip,
knee, ankle, toe) uses exact two-bone IK; a longer leg (say hip, stifle, hock, fetlock, hoof) uses FABRIK with a pole.

| Leg field | Type | Meaning |
|---|---|---|
| `side` | `"left"` or `"right"` | The side of the body (+X is the character's left). |
| `phase` | number, 0 up to (not including) 1 | The leg's offset in the gait cycle: the leg lands when the cycle reaches this fraction. Default for two legs: left 0, right 0.5. Without a template, required on every leg when there are more than two. |
| `bend` | `"forward"`, `"backward"` or `"up"`, or an array | The side each bending joint points to: toward the body's front (+Z), its back (-Z), or up (splayed legs, like a spider's, whose knees rise above the hip). An array gives one value per bending joint, the joints strictly between the hip and the ankle (`joints.length - 3` of them); `"up"` cannot be mixed with the others. Default `"forward"`. The rest position of a joint does not choose its side. |
| `limits` | `{ "min": degrees, "max": degrees }` | Flexion range of every bending joint, -180 to 180, enforced by the IK and measured by `kneeLimitViolations`. Default 0 to 150 degrees (a 4-joint leg's IK enforces it only when given). |

**Arms** swing about their first joint, in counter-phase to the nearest leg on the same side, by
`gait.armSwingDegrees`. `carried` lists joints that move rigidly with the arm, such as the tip of a held sword.

**Appendages** hang off the body, or off any joint (see `parent`), and swing with its motion. Each segment is a rigid
bone pulled by a damped spring toward its rest direction relative to its parent segment (the first segment's parent
is the joint the appendage hangs from), so a tail lags when the body speeds up, turns or bobs, and settles back. There
is no gravity: the rest pose is the shape it returns to.

| Appendage field | Range | Meaning |
|---|---|---|
| `stiffness` | 0 to 1, default 0.6 | How hard it springs back: natural frequency 0.3 Hz at 0 up to 3 Hz just below 1; exactly 1 is rigid. |
| `damping` | 0 to 1, default 0.4 | Damping ratio: 0 swings on, 1 settles without overshoot. |
| `parent` | joint name, default the pelvis | The joint the appendage hangs from: it moves and turns with that joint (a tassel on a hand, a plume on a helmet joint, a tail on the last joint of another appendage). |
| `oscillate` | `{ "axis": [x, y, z], "degrees": number, "period": seconds, "phase": 0..1 }` | Optional rhythmic swing of the first segment about `axis` (in the parent joint's frame, which is body space for the default pelvis parent; `[0, 1, 0]` wags side to side), `degrees` (0 to 180) either way, one full swing every `period` seconds (required when `degrees` > 0). The rest of the chain follows. |

A soft appendage on a very fast spin (a half turn in a fraction of a second) trails nearly 180 degrees behind and
flails; keep stiffness up or turns slower.

### Templates

A template is a preset, never a limit: any number of legs works with or without one. It fills in what a limb or the
gait leaves out.

| Template | Legs | Phases | `stanceFraction` | Bends | `lateral` | `armSwingDegrees` |
|---|---|---|---|---|---|---|
| `biped` | 2 | left 0, right 0.5 | 0.6 | forward | `spacing` | 20 |
| `quadruped` | 4 | walk: left hind 0, left front 0.25, right hind 0.5, right front 0.75 | 0.75 | hind backward, front forward | `spacing` | 0 |
| `hexapod` | 6 | alternating tripod: each side 0, 0.5, 0 from the hind leg, the other side half a cycle later | 0.6 | forward | `rest` | 0 |
| `octopod` | 8 | alternating tetrapod, as the hexapod | 0.6 | forward | `rest` | 0 |

Phases and bends are assigned per side, from the hind leg forward, by the rest hip position (larger z is further
forward), so the order of the file does not matter. `pinata new` also scales starting gait values by leg length.

**Labels.** Hints and gate names call the legs `left` and `right` for two legs, `left front`, `left hind`, ... for
two per side, and `left 1` .. `left n` (front to back) for three or more per side, followed by the limb name with more
than four legs. Arms are `left arm`, or `left arm 1` .. `n` front to back when a side has several.

### Many legs

- **Landing spots.** By default each foot lands under its own hip along the body and at `footSpacing` / 2 from the
  centre line. With `"lateral": "rest"` in the gait (the hexapod and octopod default) it lands where its ankle is in
  the rest pose, relative to the body: fan the feet out in the rest pose and they plant there while walking
  (`footSpacing` is then unused, though still required). When the character stops, each foot steps beside its
  opposite partner at the rest sideways gap, level with the partner along the body, so give partners the same rest z.
  Put the pelvis joint (the root) between the front and hind hips.
- **Stance.** One foot is always in the air unless `stanceFraction` is at least 1 minus the largest gap between
  consecutive leg phases (0.75 for a quarter-cycle walk, 0.5 for a tripod). A smaller value is a load error.
- **Proportions.** Each foot swings up to `strideLength` / 2 either side of its landing spot, so keep `strideLength`
  under about 0.6 times the front-to-back distance between neighbouring hips (or neighbouring feet, for splayed legs). A
  longer stride makes a foot reach past its neighbour, which reads as crossed legs. Shortening the stride raises the
  step rate, so lower the script speed with it.
- **Balance.** With more than four legs the walk must be statically stable: the body centre (the volume-weighted
  centre of the pelvis and upperBody parts) has to stay over the area enclosed by the feet on the ground
  (`unbalancedFrames`). Keep the heavy body parts centred over the legs, and keep neighbouring legs half a cycle
  apart. Two- and four-legged walks balance dynamically and are not gated.
- **Start.** The walk starts from the rest pose with all feet planted. Give the script an `accelSeconds` at least as
  long as the first stance (about a second for a dog), or the rest-pose plants fall inside the steady window and
  distort `rootSpeedError`.

Starting values for a dog 0.6 m tall at the shoulder: `strideLength` 0.4,
`referenceSpeed` 0.35 (also the script speed), `stanceFraction` 0.75, `stepHeight` 0.07, `bobAmplitude` 0.008,
`footSpacing` 0.18 (the hip distance), `armSwingDegrees` 0, `accelSeconds` 1. A quadruped's joints flex quickly, so
a low reference speed is what keeps `kneeSpeedDegPerSec` down: the peak grows with speed and barely changes with
stride. Short legs need a `stepHeight` of at least about 5 cm to leave the 2 cm plant height cleanly.

### Gait

| Field | Range | Meaning |
|---|---|---|
| `strideLength` | above 0, at most 10 | Metres travelled per full cycle at `referenceSpeed`. About 1.4 x leg length for two legs, 0.85 for four, 0.6 for six, 0.5 for eight. |
| `referenceSpeed` | above 0, at most 20 | m/s at which stride equals `strideLength`. Use the speed in the walk script. |
| `stanceFraction` | 0.5 to 0.8 | Fraction of the cycle a foot is planted. Two legs: start at 0.55, keep below 0.7; four legs: 0.75; many legs: 0.6 or more. A lower value lowers knee speed. Optional with a template. |
| `stepHeight` | 0 to 2 | Metres of swing-foot lift. Must clearly exceed 0.02. Start at about 0.15 x leg length. A higher value raises knee speed. |
| `bobAmplitude` | 0 to 1 | Metres of pelvis bob. 0.015 to 0.025 typical. The walk lowers the pelvis when a leg would otherwise be overstretched, and a bob smaller than that drop does not show: legs nearly straight at rest (short legs especially) hide the bob. Bend the knees more at rest to get it back. |
| `armSwingDegrees` | 0 to 90 | Arm swing, against the nearest leg on the same side, so left and right arms swing opposite ways. Optional with a template. |
| `footSpacing` | 0 to 2 | Metres between left and right foot plants. Use the distance between the hip joints. Unused by legs that plant at rest (`lateral`). |
| `lateral` | `"spacing"` or `"rest"`, optional | Where feet land: under the hip at `footSpacing` / 2 from the centre line (default), or at each ankle's rest position relative to the body (default for the hexapod and octopod templates). |
| `strideExponent` | 0.2 to 1, optional, default 0.5 | How fast stride grows with speed. Stride is `strideLength * clamp((speed / referenceSpeed)^strideExponent, 0.5, 1.5)`. |

Leg length is hip y minus ankle y in the rest pose. Starting values for two legs: `strideLength` 1.4 x leg length,
`footSpacing` hip distance, `stepHeight` roughly 0.15 x leg length, `stanceFraction` 0.55, `bobAmplitude` 0.015,
`armSwingDegrees` 20. A stride much longer than that makes the pelvis drop to keep the feet on the floor (it shows
as ground penetration, `reachViolations` or a wrong `rootSpeedError`, not as an obvious stride problem), so check
`strideLength` against the leg length before chasing joints. For more legs, start from `pinata new` with the matching
template, whose gait is scaled from leg
length, or from the dog values above. `stepHeight` and `stanceFraction` trade off: a foot that is lifted too little
slides at lift-off and touch-down (fix: raise `stepHeight`), and a high `stepHeight` makes the knee flex fast (fix:
lower `stanceFraction`, or lengthen the stride a little: a longer stride, within the ratio to the leg length above,
often resolves the slide and knee-speed trade-off when neither value alone does). Walking slower does not reliably
lower knee speed.

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
| `bind` | array of joint names | no | Joints that follow the cloth, so the parts drawn on them swing with it: see below. |
| `wind` | object | no | Constant wind with gusts. |
| `durationSeconds` | number above 0, at most 600 | no | Length of the simulation. Default: script length plus 3 s. |

### bind

A list of joints, each moved every frame by the cape or chains so that a sprite drawn on it hangs and bends as the
cloth does: a cape's hem joints, a cloak's or robe's bottom joint, a scarf's end. The part ending at the joint is drawn
along a curve that runs from the part's first joint down the cloth to the joint, at the part's drawn length. Bind a
joint whose part lies along the cloth; a joint drawn on an ornament that does not hang (a crest over a helmet) stays
unbound. Names must be joints of the mannequin, not the cloth's own anchors, with no duplicates, and the motion must
have a cape or chains.

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
    { "action": "move", "speed": 0.9, "duration": 2.5 },
    { "action": "hold", "duration": 1 }
  ]
}
```

### cape

A grid of cloth particles hung from two joints and pulled down by gravity.

| Field | Type | Meaning |
|---|---|---|
| `anchorLeft`, `anchorRight` | joint names | Top corners. Must be different joints at different positions. Both must be `rig.pelvis` or listed in `rig.upperBody`, because the cloth is pinned to the body as one rigid piece; an anchor on a leg or arm joint is an error. Put them on the shoulders or upper back, slightly outside the body so the cloth hangs clear. |
| `columns`, `rows` | integers 2 to 64 | Grid size. 4 to 8 is enough at pixel-art scale. |
| `length` | number > 0 | Cape drop in metres. |
| `material` | string | A name in `materials.json`. |

### chains

Each chain: `anchor` (joint name, listed in the rig), `links` (integer 1 to 64), `linkLength` (metres, above 0),
`direction` (`[x, y, z]`, non-zero, the initial direction the chain points from the anchor), `material` (name in
`materials.json`). Total length is `links * linkLength`. The first two particles are pinned to the anchor joint, so the
first link always points along `direction` relative to the body, however the chain is meant to hang.

A chain or the cape may carry an optional `render` object, `{ "material": "pink", "radius": 0.016 }`: `material` is a
key of `materials` in `style.json` and `radius` is the thickness in metres. The pixel renderer then draws that strand as
thin capsules, one per link (for the cape, one per grid edge), in a single colour of that ramp; without `render` the
strand is simulated but not drawn. Rendered strands are not collision parts and are not checked by the static gates;
`pinata check` draws them into `sheet.png` and `walk.png` (the sheet shows the middle of the first steady walk).

### wind

`{ "direction": [x, y, z] (non-zero), "speed": m/s >= 0, "gust": number in [0, 1] }`. `gust` is a fraction of `speed`.

### Cloth rules

- A part drawn only as a stand-in for a cape or chain (so you can see it in the views) collides with the cloth that
  represents it; list it in `exclude`.
- The cloth collides with the body parts but has no floor collision. When the bottom rows of the cape hit the legs or
  feet (`penetratingFrames` with the deepest point in a leg or foot), shorten the cape `length`.
- Without `cape` and `chains`, the cloth gates are skipped and the summary header says so.

## Gates

Each gate passes when `value op threshold` holds. `summary.txt` gives a hint for every failure; the sections below
say what each gate measures and the usual fix. Static gates look at 32 px and 48 px views, at elevations 0 and 30
degrees, in eight directions (32 views).

### Static gates

The static gates are evaluated on the body parts only. The cloth parts that `sheet.png` shows (chains and the cape,
drawn as thin capsules) are not part of them: they are thin by design, so `maxThinFraction`, `maxStrayPixels` and
`paletteSize` do not count them, and a strand drawn over the body does not change any gate value.

| Gate | Passes when | Measures |
|---|---|---|
| `outlineGaps` | = 0 | Silhouette pixels touching the image edge, meaning something is clipped. |
| `maxThinFraction` | <= 0.25 | Worst fraction of a part's pixels that are a single pixel wide. |
| `paletteSize` | <= 16 | Distinct colours over all views. |
| `maxStrayPixels` | <= 2 | Isolated single pixels (not decals) in the worst view. |

- **maxThinFraction.** A part that is one pixel wide flickers and vanishes. At 32 px a part must be at least 2 px
  across, which is `height / 16` metres (0.075 m for a 1.2 m character); aim for 3 px (`3 * height / 32`). "Across"
  is a diameter: a capsule is `2 * radius` (of the thinner end), so 0.075 m across needs a radius of 0.0375 m; for a box
  use the smaller of `width` and `thickness`. Parts with fewer
  than 4 visible pixels in a view are ignored. A side covered by a part in front is not an edge, so hiding a wide part
  behind another does not make it thin. What fails is a 1-px strip of a part that is still visible past a part in front
  of it (a foot peeking out under a shin in the back view, a hand beside a thigh). The hint names the part and the
  one in front. Show more of the strip (move the part outward or enlarge it), hide it completely (under 4 visible
  pixels it is ignored), or set `allowThin: true`. For something meant to be a line, set `allowThin: true`.
- **paletteSize.** Every distinct colour counts: ramp colours that appear, decal colours, and the outline colour
  (`selective` mode usually uses fewer). Fix by sharing materials between parts, using one fewer band (this
  removes one colour from every ramp), or using fewer decal colours. Every ramp needs exactly `bands.length + 1`
  colours, so you cannot drop a single colour from one ramp. Budget before drawing: materials x (`bands.length + 1`)
  plus decal colours plus the outline must be at most 16, so 5 materials of 3 shades and 1 decal colour already fill
  it; plan materials as a shared set (skin, cloth, metal, leather, one accent) rather than one per part.
- **maxStrayPixels.** Isolated pixels come from parts smaller than a pixel or mostly hidden behind a neighbour. Make
  them larger, merge them into a neighbouring part, or draw them as a decal. A small feature next to larger parts (a
  beard, an eye, a buckle, a badge) works better as a decal than as a part: a decal is exempt from this gate and
  from `maxThinFraction`.

### Locomotion gates

The walk is simulated with your rig, then measured at 48 px (one pixel is `height / 48` metres).

| Gate | Passes when | Measures |
|---|---|---|
| `footSlidePx` | <= 0.25 | Horizontal movement of a planted foot (its sole within 2 cm of the floor for two frames). |
| `groundPenetrationPx` | <= 0.5 | Deepest the sole goes below y = 0. |
| `partGroundPenetrationPx` | <= 0.5 | Deepest any non-foot part goes below y = 0. |
| `reachViolations` | = 0 | Frames where a foot target was beyond the leg's reach and the leg was clamped straight. |
| `kneeLimitViolations` | = 0 | Joint-frames, counted over every bending joint of every leg, with flexion outside the leg's limits (default 0 to 150 degrees) or the joint pointing away from its `bend` side. The wrong-way test is skipped when `limits.min` is negative. |
| `kneeSpeedDegPerSec` | <= 600 | Peak bending speed of any bending joint of any leg. |
| `boneLengthError` | <= 0.01 | Relative change of leg and arm bone lengths. |
| `rootSpeedError` | <= 0.05 | Relative difference between foot-measured speed and the script speed in steady windows. |
| `unsupportedFrames` | = 0 | Frames where no foot is within 2 cm of the floor. |
| `alternationViolations` | = 0 | Plants in steady windows by a leg other than the one whose phase comes next after the previous plant's leg. With two legs: the same foot planting twice in a row. |
| `plantedFrames.left`, `.right` | >= 1 | Each foot is planted at least once. One gate per leg, named by its label: `plantedFrames.left hind`, `plantedFrames.left 2`, ... |
| `unbalancedFrames` | = 0 | More than four legs only: frames where the body centre is more than 2 cm outside the area enclosed by the feet within 2 cm of the floor. |
| `appendageBoneLengthError` | <= 0.01 | With appendages only: relative change of appendage bone lengths. A construction check. |
| `appendageNonFinite` | = 0 | With appendages only: appendage joint positions that are not finite numbers. A construction check. |

Usual fixes:

- **footSlidePx.** First check that the foot is level: `ankle.y - radiusA` must equal `toe.y - radiusB` (the hint
  prints both). If it is level, the usual fix is to raise `stepHeight` (start at about 0.15 x leg length; the slide
  happens at lift-off and touch-down when the foot barely leaves the floor). Raising `stepHeight` raises knee speed,
  which a lower `stanceFraction` offsets. Changing `strideLength` is unreliable.
- **groundPenetrationPx, plantedFrames, unsupportedFrames.** Check that the foot is level, then check the stride
  against the leg length (the hint says when it is far over): a long stride drops the pelvis, and shortening
  `strideLength` (and the script speed with it) is the fix before `bobAmplitude` or `stepHeight`.
- **partGroundPenetrationPx.** A part (a dragged sword tip, a low hand, a hem) reaches the floor. Raise its joints in
  the mannequin, or reduce `bobAmplitude` and `armSwingDegrees`; a stride far over the leg length also drops the
  pelvis and the parts with it.
- **reachViolations.** The stride asks the legs to reach too far. Shorten `strideLength`, `footSpacing` (not with
  `lateral: "rest"`, which ignores it: bring the rest feet in instead) or `bobAmplitude`, or lengthen the legs.
- **kneeLimitViolations.** The value counts joint-frames over all legs. The hint names the joint: if it bends the
  wrong way, its `bend` does not match the rest pose; otherwise it is overbent: lower `stepHeight` or lengthen the
  legs.
- **kneeSpeedDegPerSec.** Lower `stanceFraction` (longer, slower swing; the minimum is 0.5, or 1 minus the widest
  phase gap if higher: 0.75 for a four-legged walk, so there it cannot go lower) or lengthen the stride a
  little. A higher `stepHeight` raises knee speed; lower it only if the slide and alternation gates still pass.
  Walking slower does not reliably help. Short legs with a high step height are the usual cause, and so are legs
  nearly straight at rest: a joint bent less than about 25 degrees has to fold fast to lift the foot, so bend it
  25-40 degrees in the mannequin first (the hint says when).
- **boneLengthError.** A joint of a limb is also listed elsewhere (for example in `upperBody` or `carried`), or two
  joints of a limb are at the same position.
- **rootSpeedError.** Feet must plant at least twice inside a steady window. If the window is shorter than 2.5
  cycles, lengthen the `move` segment (or shorten `strideLength`). If the window is already long enough and the value
  is `Infinity`, the feet never rise above 2 cm, so raise `stepHeight`. A window that is long enough with a finite
  error usually means the stride is too long for the legs (see the gait section): shorten `strideLength`.
- **unbalancedFrames.** The hint names the worst frame and the feet on the ground. Raise `stanceFraction` so more
  feet are down at once, keep neighbouring legs half a cycle apart, spread the feet wider (`lateral: "rest"` with
  splayed feet), or move heavy parts toward the middle of the legs.
- **alternationViolations.** The swing foot does not rise enough to count as a step: raise `stepHeight` well above
  0.02 m and keep `stanceFraction` below 0.7 (with four legs, check the `phase` values against the walk order
  instead; they need `stanceFraction` 0.75 or more).

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
- **penetratingFrames.** If the part the cloth is inside is a stand-in for the cloth, add it to `exclude`. If the
  deepest point is in the bottom rows and inside a leg or foot, shorten the cape `length` (the cloth has no floor
  collision). Otherwise move the cape anchors outward so the cloth starts clear of the body.
- **maxSpeed at the start.** When frame 0 already penetrates and the fastest particle is in the first frames, the
  cloth starts inside a part: move the cape anchors outward rather than raising `substeps`.

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
    "stanceFraction": 0.55,
    "stepHeight": 0.055,
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
      { "action": "move", "speed": 0.9, "duration": 2.5 },
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

Result of `pinata check <dir>`:

```
check: bolt (<dir>)
PASS  outlineGaps: 0 <= 0
PASS  maxThinFraction: 0.200 <= 0.25
PASS  paletteSize: 11 <= 16
PASS  maxStrayPixels: 2 <= 2
PASS  footSlidePx: 0.017 <= 0.25
PASS  groundPenetrationPx: 0.000 <= 0.5
PASS  partGroundPenetrationPx: 0 <= 0.5
PASS  reachViolations: 0 <= 0
PASS  kneeLimitViolations: 0 <= 0
PASS  kneeSpeedDegPerSec: 548.254 <= 600
PASS  boneLengthError: 0.000 <= 0.01
PASS  rootSpeedError: 0.000 <= 0.05
PASS  unsupportedFrames: 0 <= 0
PASS  alternationViolations: 0 <= 0
PASS  plantedFrames.left: 178 >= 1
PASS  plantedFrames.right: 181 >= 1
PASS  nonFinite: 0 <= 0
PASS  maxSpeed: 2.762 <= 15
PASS  maxStrain: 0.065 <= 0.1
PASS  penetratingFrames: 0 <= 0.01
automated gates: PASS
```

Things this example shows: the feet are capsules from ankle to toe with the ankle at the foot's `radiusA` height
(0.06) and the toe at `radiusB` height (0.04), so the foot is level; the knees sit 0.03 m in front of the hip-ankle line
(this only sets the thigh and shin lengths; knees always bend forward); every joint
(including eye, lamp and antenna joints) is listed exactly once in the rig; the thin `antenna` part has
`allowThin: true` and is listed in `exclude` because the chain represents it; hands are larger than the forearms and
the arms hang away from the torso so they are not hidden in side views.

## Skin, motion and export

`render` and `export` animate the character with retargeted motion capture and draw it with a skin you draw, in eight
directions. They need two more files next to the six, and a humanoid body.

### Humanoid requirements

The capture drives joints by name, so the mannequin needs `pelvis`, `chest`, `head`, and for each side `hipL`, `kneeL`,
`ankleL`, `toeL`, `shoulderL`, `elbowL`, `wristL`, `handL` (and the `R` set), with the legs and arms of `rig.json`
built on them: what `pinata new --template biped` writes. Add the character's own joints (a hat tip, a cape anchor,
eyes, a plume base) freely; the rig must list them (`upperBody`, `attached`, `carried`).

### retarget.json

```json
{
  "hang": { "chest": ["shoulderL", "shoulderR", "head", "capeAnchorL", "capeAnchorR"], "head": ["hatTip", "eyeL", "eyeR"] },
  "style": { "amplitude": { "hipL": 1.3, "hipR": 1.3, "kneeL": 1.2, "kneeR": 1.2, "shoulderL": 1.8, "shoulderR": 1.8 } }
}
```

Both fields are optional. `hang` says which joints follow the chest and the head instead of the pelvis: put the
shoulders, the head and everything on the upper torso (cape anchors, an emblem) under `chest`, and the hat, face, eyes
and plume under `head`, so they turn with the spine and neck; a joint named nowhere moves rigidly with its parent.
`style.amplitude` scales a joint's captured movement (1.3 on hips and 1.8 on shoulders livens a stiff walk; below 1
stiffens); `offset` (fixed degrees `[x, y, z]` per joint), `variation`, `rate` and `stride` (0.5 to 2) are the other
fields. A wrong joint name is reported with the file and path.

### Cape and cloth in a skinned character

A cape is cloth: `motion.json` simulates it and the skin draws it by binding sprites to the simulation. In order:

1. `mannequin.json`: anchor joints on the upper body (`capeTopL`, `capeTopR`, in `rig.upperBody`), hem joints
   (`capeHemL`, `capeHemR`) and a stand-in part from top to hem for each side (`capeL`: `capeTopL` to `capeHemL`).
2. `motion.json`: `cape` (see cape above), both stand-ins in `exclude` and the hem joints in `bind`.
3. `skin.json`: a sprite for each stand-in in every view, laid along the cloth's curve as it swings.

A `loop` FAIL in `export` on a caped character is the cape's drawn edge changing by many pixels a frame: the cut's
seam then exceeds the median of those steps. No cloth setting is sure to remove it. A change to `length`, `columns` or
`damping` moves the cut, so change one thing, export again, and read the seam numbers.

### Drawing the skin

`pinata skin guide <dir> <out>` writes `guide.md` (for each of five views, every part's joint positions in pixels,
bone length, width, and which way its top faces) and the five view images. Draw against it, then `skin preview`.

```json
{
  "name": "my-knight",
  "palette": { "o": "#1b1421", "s": "#7b8aa8", "h": "#e0e4d6" },
  "views": {
    "front": { "parts": { "forearmR": { "rows": [".hhhhhh.", "sssssss.", ".sssss.."], "pivotA": [2, 1], "pivotB": [6, 1] },
                          "capeL": { "hidden": true }, "capeR": { "from": "side.capeR" } } },
    "frontSide": { "parts": {} }, "side": { "parts": {} }, "backSide": { "parts": {} }, "back": { "parts": {} }
  }
}
```

(The example is cut short: every view lists every part.)

- **Views.** `front` faces the viewer, `frontSide` is 45 degrees, `side` faces screen-right, `backSide` is 135 degrees,
  `back` faces away. The eight directions use these, left-facing ones mirrored: a mirrored view draws each part's
  counterpart (`...L` and `...R`) flipped, so draw a left and a right sprite as a near and a far one, and a pair
  whose two sprites cannot suit both bones will compromise.
- **Parts.** Every mannequin part has a sprite in every view, or `{ "hidden": true }` where it cannot be seen.
  `{ "from": "view.part" }` (or `"part"` in the same view) copies another sprite, and may add its own `layer`.
- **Sprites.** `rows` are equal-length strings (at most 64 by 64), one per pixel row; `.` is transparent; any other
  character must be in `palette`. One sprite pixel is one screen pixel at 48 px tall: never scale.
- **Two-joint parts** (limbs, cape, sword, foot) are drawn lying along +x from joint A to joint B. `pivotA` is the
  pixel `[column, row]` (0-based from the top left) that sits on joint A, and `pivotB` the pixel on joint B, on the
  same row and to its right. Joints are the centres of the rounded ends, so the sprite extends past each pivot by
  about the end radius. The pivot distance should match "Bone (px)" in `guide.md`. The renderer rotates the sprite to
  the bone's angle in steps of 22.5 degrees, and the `guide.md` column "Top faces" says where its top row ends up
  (hanging limbs: the front; a torso: the back; a foot: still the top, or "as drawn" in the front and back views).
- **Single-joint parts** (a helmet, a hand, a pauldron: both joints the same) take only `pivotA`, the part's centre,
  and are drawn upright, not rotated. `"upright": true` on a two-joint part draws it as it stands on screen, with
  `pivotB` in the same column as `pivotA` and below it.
- **Layers.** Parts are drawn farther before nearer; `"layer": n` (an integer, higher draws over lower, default 0)
  overrides that for a part, such as a boot that must show over the other leg.
- **Palette.** At most 16 colours for the whole skin (one character each, mapped to `"#rrggbb"`, `.` not allowed as a
  key), shared by all sprites; include one very dark colour. The renderer outlines the silhouette with the darkest
  colour, draws inner lines where parts overlap and darkens the far limb of each pair, so do not outline the sprites'
  outer edges yourself. It never blends or creates colours.
- **Style.** Light comes from the upper left front. At 48 px a torso is about 9 by 12 px: draw clean clusters, one
  light direction, a few highlights. Limbs must still read rotated up to 40 degrees. Reuse a few ramps.
- **`skin preview <dir> skin.json <out>`** validates (errors name the path to the problem, `skin: INVALID`, exit 1)
  and draws `directions.png` (the eight directions), `turntable.png` (32 steps), `walks.png`. Check that every part
  sits on the body, limbs join at the joints without gaps and the walk reads. `--clean` rotates at 11.25 degrees.
- **`skin fit <dir>`** prints `n part views outside the drawn-length bounds`; keep it at 0. A line such as
  `torso front: sprite span 5 (drawn 3 to 6.25), bone projects 8.3 px` says that sprite's pivot distance
  (`pivotB` column minus `pivotA` column) lets it draw between 3 and 6.25 px, but the bone on screen is 8.3: redraw
  it with a span near the bone's length (keeping the end caps). A foreshortened part (a sword pointing at the viewer, a
  foot in the front view) needs a short span there.

### The ground gate

`export` draws the idle loop in every direction (`check` does too, once the skin and `retarget.json` exist, as
`idleFootMisses`). Two gates look at the feet; the views are
`front` for front, `frontSide` for front-left and front-right, `side` for left and right, `backSide` for back-left and
back-right, `back` for back.

- `drawn`: in each view, each foot must have a visible pixel in at least one frame of at least one of the view's
  directions (the side views' two directions swap near and far, so each foot is near in one; front and back have one
  direction). A `hidden` or empty foot, or one covered in every frame, fails. Draw both feet in all five views; if a
  garment covers them, give the foot a `layer` above it. Failing line: `idle (view <view>): ...`.
- `ground`: each planted foot's lowest drawn row must be within 1 px of its own ground point (the sole of the
  foot capsule, projected from the ground), in at most 5% of the planted foot-frames. What is drawn over the foot
  does not count. Fix it in the foot sprites' pivots:

1. A foot sprite's `pivotA` and `pivotB` rows set its height. Measured on the idle's frames, in every view and for
   both feet: one row more draws the foot's lowest row exactly one pixel higher, one row less exactly one pixel lower,
   and the other foot does not move. The sprite's bottom row (the last with an opaque pixel) is the sole and stands
   `bottom row - pivot row` pixels below the ankle, so aim the sole at the ground. Read the failing line's `below` or
   `above` and move both rows by about that many. An `upright` sprite's rows are the file's own rows, along its bone,
   and move it the same way. The rule needs room: a pivot on the sprite's first or last row cannot move past it, so add
   a transparent row. A foot is the capsule from a leg's ankle to its toe in `rig.json`. In the `front` and `back`
   views, where the foot is seen end-on, it is drawn as it is in the file (an `upright` sprite stands up), not turned.
   In the `frontSide`, `side` and `backSide` views it is turned with its bone.
2. A view's two directions share its two foot sprites, swapped: one direction draws `footL` for the far foot and
   `footR` for the near one, the other the reverse. When one direction passes and its mirror fails, move the sprite of
   the failing foot by one row and read both directions' lines again; the two feet stand at different pitches, so aim
   each sprite between its two feet rather than at one.
