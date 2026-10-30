# Image and Points: Animate Any Artwork

**Goal:** a character is an image plus any number of points placed on it. Piñata animates the points (gait, IK,
springs, oscillators, behaviours) and the image follows by a 2D mesh warp, re-pixelated cleanly. Nothing in the engine
depends on named body parts: a point is a point, and what moves it is configuration. Templates (biped, quadruped,
hexapod, octopod) stay as starting points: a preset set of points and drivers that the author refines.

**Status:** approved by the user on 2026-10-30, batch A first, then the runtime spike (P8) on top of it (decisions: 2D
mesh warp; points placed by the author, with a helper that can propose them; one shared motion core with the 3D
mannequin and the image warp as two renderers). P2's `partAreaJump` stays a recorded fail; area change is measured
properly by this plan's `areaChange` gate instead.

**Constraint:** existing packages keep working, and every existing output stays byte-identical (P1, P3, P4, P6 and
`check` on every example), as in the general limbs work.

## Why

The general limbs work removed the fixed leg count, but the model still has fixed roles: one rigid `upperBody`, limb
kinds, appendage roots that can only ride on the body, cloth pins that follow a joint's position but not its
rotation, and a 3D capsule mannequin as the only visual. Authors (people or AI agents) usually start from artwork. If
the artwork plus a handful of points is enough, anything can be animated: a creature, a mascot, a logo, a prop.

## Model

### Points

A point has a name, a rest position, an optional parent, and optional role tags used by templates and masks (`foot`,
`hip`, ...; tags are free text, the engine gives none of them meaning except where a driver is configured to use
them).

- **Hierarchy.** Every point except the root has a parent. A point without a driver inherits its parent's motion
  rigidly (translation and rotation). This replaces `pelvis`/`upperBody`/`carried` and the "every joint in exactly one
  group" rule: the hierarchy is the coverage.
- **Rotation.** Each point carries a frame (position and rotation), so children, pins, cloth anchors and image regions
  turn with their parent, not only move with it.
- **Coordinates.** Always 3D (see "3D core, 2D views"). An image's points give x and y on the image plane plus a
  depth; renderers project the posed 3D points into their view.

### Drivers

A driver moves a chain or a subtree of points, and is attached by point names, never by part names:

| Driver | Moves | From today's code |
|---|---|---|
| `root` | the root point: path, yaw, bob | motion script, gait bob |
| `gait` | chains ending in planted points: footstep plan plus IK | legs (planner, two-bone and FABRIK IK) |
| `swing` | a chain rotating about its first point, in phase with a gait chain | arm swing |
| `spring` | a chain following its rest direction relative to its parent, with an optional oscillator | appendages |
| `cloth` | particles pinned to points (now with rotation) | cape, chains |
| behaviours | layers, additive overlays and events over point masks | composable behaviours spec |

Masks in the composable-behaviours spec become sets of points (subtrees or tags) instead of limb names.

### Templates

A template is a preset of points (names, rest layout, parents, tags) and drivers (which chains are gait chains,
their phases and bends, which swing, gait values scaled by size). `npm run new` keeps writing one, and the new
image workflow places a template's points onto an image as the starting layout to refine. Explicit settings always
win; nothing requires a template.

### Translation

Today's packages translate on load, as `legs`/`arms` translate to `limbs` now: `pelvis` becomes the root,
`upperBody` and `carried` become children of the root and the hand, each limb becomes a chain with its driver, and
mannequin parts attach to their two joints. The translated model must reproduce today's poses exactly.

## 3D core, 2D views

The motion core is 3D and stays 3D: points carry full 3D rest transforms (position and rotation) and a depth even
when the art is flat, and every driver (root, gait and IK, swing, spring, cloth, behaviours) works in world space.
2D is one way of showing it, never an assumption of the core. This keeps a later move to 3D open and lets 3D effects
show up on 2D art.

**Renderer interface.** A renderer takes the posed points (world transforms per frame) and a camera and returns a
frame; nothing in the motion code knows about pixels, meshes or images. Renderers:

| Renderer | When | Notes |
|---|---|---|
| Capsule mannequin | today | 3D primitives rasterised and stylised to pixel art (P1, P6) |
| Image warp | this plan, batch C | the author's image deformed by the projected points |
| Skinned 3D model | later | a 3D mesh on the same skeleton and drivers |
| Export | later | skeleton and animation as glTF for game engines; frames as sprite sheets (today) |

Gates that measure motion (foot slide, reach, balance, joint speed, bone lengths) are computed in world space, so they
hold for every renderer; renderer gates (palette, outlines, stray pixels, flicker, fold-overs) are per renderer.

**Depth.** Every point has a depth: from the template, from the helper, or set by the author. It gives draw order for
near and far parts, foreshortening as a part swings toward or away from the camera, and slight parallax between
layers.

**3D effects on 2D art** (later batches, each with its own gates, fixed in a plan before it is built):
- Lighting: a normal map for the image (drawn by the author or estimated from the art) lit by a 3D light through the
  existing banded style, so shading follows turns and bends.
- Shadows and contact: a ground shadow from the 3D pose; feet visibly meet it.
- Camera: small camera moves and other elevations re-project the same motion.
- Physics: cloth, chains and springs simulate in 3D and are projected, so they wrap around the body.
- Turning: one image per major view with the same point names, switched or cross-faded at the right angles as the
  3D yaw passes them, and Live2D-style keyed shapes (for example a head at -25, 0 and +25 degrees) blended by the
  actual 3D angle within a view. A single image covers turns of about 20-30 degrees convincingly; a full turn needs
  one image per major view (4 or 8 directions, as game sprites ship).

## Image renderer

1. **Input:** `image.png` (pixel art at its target size, or larger art to be reduced), and `points.json` with each
   point's image coordinates, parent and optional depth. Optionally a region map (a second image or polygons) that
   says which pixels belong to which part of the hierarchy where proximity alone would be wrong (an arm in front of
   the body).
2. **Mesh.** Triangulate the sprite's opaque area (constrained to its outline, with interior points and every
   anchor as vertices).
3. **Weights.** Skinning weights per vertex from the points: geodesic distance inside the silhouette (so an arm does
   not drag the body next to it), limited to a few influences, overridden by the region map.
4. **Warp.** Per frame, transform vertices by their weighted point frames (linear blend, or dual quaternion if
   candy-wrapping shows), rasterise source pixels through the mesh with nearest-neighbour sampling.
5. **Re-pixelation.** Keep the source palette exactly, keep 1 px outlines continuous, avoid stray and doubled
   pixels (RotSprite-style resampling for rotated regions), and reuse P2's temporal hysteresis against flicker.
6. **Directions.** One image gives one view. Other directions need their own image and points (or a mirrored one);
   the motion core is shared, so all views animate in sync.

## Point helper

A command that proposes points for an image: from a template (fit the preset layout to the silhouette) and/or from
the silhouette's skeleton (medial axis: ends become tips, branch points become candidate joints). Output is an
ordinary `points.json` the author edits. `check` validates any points file the same way, wherever it came from.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs identical | pixels identical for P1, P3, P4, P6 and `check` on every example | translation to the point model |
| Translated poses | every joint within 1e-12 m of today's pose, every frame, every example | regression |
| `paletteEscapes` | 0 | warped frames use only colours of the source image (plus transparent) |
| `meshFoldovers` | 0 | triangles that flip orientation in any frame |
| `outlineGaps` | 0 | as the static gate, on warped frames |
| `maxStrayPixels` | <= 2 | as the static gate |
| `flickerFraction` | < 1% | as P2, on a slow walk |
| `areaChange` | <= 15% | per region, opaque pixel count against rest (catches collapsing or bloating parts) |
| Existing locomotion gates | pass | they measure points, so they apply unchanged |
| Determinism | 0 differing frames | re-run in a child process |
| Readability | judge panel: warped walk preferred over the mannequin render, or rated at least equal, in most comparisons, with a control (unrigged image slid along the path) that must lose | blind AI judges as in P1/P6 |

## Batches

- **A. Point model and translation:** points with parents and frames, drivers over chains, translation of today's
  packages; every existing output byte-identical. Appendage (spring) roots on any point; pins with rotation. Review.
- **B. Image and points format:** `points.json`, validation with actionable messages, templates as point presets,
  `npm run new --image <png>` placing a template's points on the image. Review.
- **C. Warp renderer:** mesh, weights, warp, re-pixelation, temporal hysteresis; the new gates in `check`. Review.
- **D. Point helper and proof:** proposals from template and skeleton; three characters from three images (a biped,
  a quadruped, something with no legs that only springs and sways); the judge panel. Findings, then a go/no-go on
  making image and points the default authoring path.
- **Later (separate plans):** turning between views and keyed turn shapes; lighting from normal maps; ground
  shadows; camera moves; a skinned 3D renderer and glTF export.

## Open questions

- Source art at the final pixel size (sharper, harder to warp) or larger (smoother warp, then reduced, which risks
  losing the hand-drawn look)? Batch C should try both on one character.
- Depth: is a per-point draw order enough for overlapping limbs, or do parts need separate layers in the image?
- Turning: one image per direction from the author, or generated directions (AI-drawn, as in the skins spike)?
- Where the point model and the composable behaviours spec should merge (masks, evaluation order) is decided in batch
  A, before the runtime spike (P8) builds on either.

## Decisions during batch A

- Transforms: every joint's pose is `rotation · rest + translation` in body-local space, with an absent rotation for
  the identity, computed as `rest + translation` exactly. Drivers keep their existing formulas for the joints they
  own (pelvis group, IK legs, swinging arms with carried joints, appendage springs) and report a transform for each;
  only joints no driver owns are placed from their parent's transform. That keeps every existing output
  byte-identical without reproducing old float operations through the hierarchy.
- Leg joints turn with the bone that leaves them (the toe with the foot), by the smallest rotation from rest: no
  twist. Good enough for attachments; a twist source can come with behaviours.
- Format, kept small until batch B's `points.json`: a rig field `attached` (`{ joint: parent }`) for joints that ride
  rigidly on any joint, and an appendage field `parent`. The hierarchy (`parentsOf`) is derived from the rig;
  cycles are load errors. Legs and arms still hang from the pelvis.
- Appendages run parents first over the whole sequence; the parent joint's rotation is interpolated between frames
  about a single axis, and the joints attached below are placed again after each appendage.
- Cloth and chain pins turn with their joint's rotation. Cape anchors must still be rigid with the body (upperBody,
  or attached joints whose parents lead to the pelvis through upperBody).
- Behaviours meet the point model as follows (decided before P8 builds on either): a mask is a set of joints, written
  as joint names, where a name stands for that joint and everything below it in the hierarchy (`"mask":
  ["shoulderL"]` is the whole left arm with what it carries and anything attached to it); limb names and `body` (the
  pelvis and upperBody) stay as shorthands. A layer writes transforms for the joints in its mask, and joints below
  them that no layer or driver owns follow by inheritance. Evaluation per frame: base drivers (root, gait and IK,
  swing), layers, constraints, inheritance, additive overlays, events, then the sequence-level springs and cloth,
  which matches the behaviours spec's order with inheritance placed after constraints.
