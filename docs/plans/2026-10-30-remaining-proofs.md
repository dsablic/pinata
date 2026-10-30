# Remaining Proofs: P2 Pixel Stability, P6 Style Swap, Skins Spike

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement each proof.

Gates are fixed here, before implementation, as for P1-P5. Judge panels follow the method in the viability design:
fresh blind judges, neutral names, both orders, controls that must fail, ground-truth questions where possible.

---

## P2 Pixel stability

**Question:** does the procedural renderer stay stable in motion (no crawl or flicker) without making motion look
steppy?

**Setup (`pocs/p2-pixel-stability/`):** the P4 knight and P1 style. Two sequences, each rendered at 32 and 48 px,
elevation 30:
- `turntable`: the knight standing at rest, yawing 1 degree per frame through 90 degrees (a slow rigid rotation is
  the worst case for crawl).
- `walk`: the P4 walk-turn-stop, camera fixed on the root's horizontal position at the first frame (so the knight
  moves across the frame).

**Control:** the same turntable with the camera shifted by a deterministic sub-pixel offset each frame
(`(0.37 * k) mod 1` px horizontally, `(0.61 * k) mod 1` px vertically), which is what an unsnapped follow camera does.
It must fail the flicker gate.

**Metrics:**
- `flickerFraction`: per frame k, pixels whose colour is A at k-1, B != A at k and A again at k+1, divided by the
  silhouette area at k; worst frame.
- `partAreaJump`: per part, the relative change in pixel count between consecutive frames, ignoring parts under
  8 pixels and frames where the part's projected bounding box moves by at least 1 px; worst value.
- `outlineGaps`: as P1, every frame.

**Gates:**

| Gate | Threshold |
|---|---|
| flickerFraction (turntable, 32 and 48) | <= 0.01 |
| partAreaJump (turntable) | <= 0.15 |
| outlineGaps (both sequences) | 0 |
| controlFails (control's flickerFraction above 0.01) | >= 1 |
| flickerFraction (walk), reported, not gated | moving limbs legitimately change pixels |

If the gates fail, the allowed fixes are renderer-side (snap the root to the pixel grid, temporal hysteresis on
shading bands and stray cleanup, stepping rotations); thresholds stay.

**Judge panel:** frame-difference maps (pixels changed from the previous frame highlighted, a strip of 12) for the
turntable, ours vs the control, both orders: "which animation shimmers more?" Truth: the control. Pass: majority
correct on both orders.

---

## P6 Style swap

**Question:** is style independent of motion: can one character and its motion be rendered in clearly different
styles that still read as the same character?

**Setup (`pocs/p6-style-swap/`):** two characters (the knight package and one character authored by an agent in P5),
three styles: the P1 default, `muted` (desaturated, 2 shades per material plus a dark outline) and `vivid` (high
contrast, 4 shades per material, selective outline). Styles are written by an agent from a one-line brief each; the
renderer is unchanged.

**Gates:**

| Gate | Threshold |
|---|---|
| motionIdentical: pose and cloth frame hashes for each character are identical across the three styles | 1 |
| Each style passes the P1 static gates (outlineGaps, maxThinFraction, paletteSize, maxStrayPixels) | all |
| Each style passes the P2 turntable flicker gate | all |

**Judge panel:** six contact-sheet crops (2 characters x 3 styles, one 3/4 view each), shuffled and unnamed:
1. "Group these into characters" (truth: by character).
2. "Group these into art styles" (truth: by style).
Pass: each judge groups both correctly, or at least 2 of 3 judges do.

---

## Skins spike

**Question:** P1 showed that a procedural renderer cannot pass as hand-made. Can AI-drawn per-part sprites ("skins"),
placed and rotated by the rig, pass where procedural rendering failed?

**Scope (kept small on purpose):** one character (the knight), one view (side, facing screen-right), 48 px. A skin
is a small pixel sprite per body part (helmet, torso, hips, upper arm, forearm, hand, thigh, shin, foot, cape,
sword, plume), each with a palette and two pivot points that map to the part's joints. A fresh agent acting as a
pixel artist draws the sprites as text grids from a short brief and the knight's part list (sizes in pixels derived
from the mannequin at 48 px). The renderer projects each frame's joints, places each part's sprite between its two
projected joints, rotates it by the bone angle with nearest-neighbour sampling snapped to 22.5 degree steps (no
smoothing), and composites in depth order, then applies the P1 outline pass.

**Gates:**

| Gate | Threshold |
|---|---|
| A/B static, same protocol as P1 (our standing frame vs the 3 hand-made references, both orders, plus 2 control pairs) | reference picked in at most 9 of 18 real comparisons; controls "can't tell" in at least 10 of 12 |
| Walk readability: 8-frame 48 px walk strip, skins vs the P4 procedural strip, both orders, "which is a better pixel-art walk?" | skins preferred by the majority in both orders |
| The artist agent finishes the sprite set within 3 attempts (format errors fixed, every part covered) | yes |

A pass means skins are a viable visual layer for the tool. A fail means visuals for the tool must come from human
artists (import of hand-made parts), and the roadmap says so.
