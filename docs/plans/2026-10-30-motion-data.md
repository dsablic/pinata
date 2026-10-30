# Motion From Real Movement: Mocap + Physics

**Goal:** characters move naturally because their motion comes from real movement, the way Prince of Persia and
Another World were rotoscoped from filmed people. Humanoids are driven by motion-capture clips retargeted to their
rigs; their feet are fixed to the terrain by IK; and a physical body (mass, momentum) supplies the root's motion and
its reactions to wind, pokes and quakes. Bodies without real-world data (insects, spiders, hexapods) keep physics plus
procedural stepping ([physical walking](2026-10-30-physical-walking.md)), and quadrupeds join the data path if an
openly licensed dataset fits.

**Decision (user, 2026-10-30):** hybrid of mocap and physics, after the physical-walking start showed that procedure
alone still reads as constructed motion.

## Data

- **Source:** the CMU Graphics Lab Motion Capture Database (free to use, including in products; the data itself may
  not be resold). A curated subset only: walks at a few speeds, a run, starts and stops, turns on the spot and while
  walking, idles with weight shifts, a stumble, a startled jump back. Fetched into a scratch folder, parsed, and
  converted into compact clips (only the joints the retargeting needs, resampled to 24 fps, rounded) committed under
  `motion/` with a licence note naming each source take.
- **Format:** a clip is joint rotations per frame for a fixed source skeleton, the root's path, and foot contact
  flags (from foot height and speed); validated by the schema checker.

## Retargeting

- A declarative map from each character's joints to the source skeleton's (`pelvis: Hips`, the leg chains to
  UpLeg / Leg / Foot / ToeBase, the arm chains, spine, neck and head), kept in the world config per cast member or per
  template, so new characters are config.
- Direction-based retargeting: each of our bones takes the source bone's direction relative to its parent, keeping our
  bone lengths; the root's height and speed scale by the ratio of leg lengths; joints the map does not name follow
  through the hierarchy. Characters whose proportions differ from a human (the dwarf's short legs, the wizard's robe)
  stay readable because only directions transfer.

## Playback

- **Selection:** a small motion-matching loop. Each candidate frame is scored on its root velocity and the next
  half-second of its root path against what the body wants (from the activity's goal and the physical body's state),
  and on its feet against the current feet; the best frame continues, with an inertialized blend (offsets decayed over
  0.2 s) at each switch. Walk and run cycles are phase-aligned and their playback speed follows the body.
- **Feet and terrain:** contact flags from the clip lock feet in world space; IK places them on the terrain through
  the existing support (pitch on ramps, treads on stairs), and the pelvis follows the planted feet.
- **Physics:** the physical body's velocity and heading lead (so wind slows a walk, a poke shoves, a quake shakes);
  the clip supplies everything above it. A shove large enough to unbalance plays the stumble.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical | offline planner and examples untouched |
| Licence | every committed clip names its CMU take; nothing else is committed from outside | review |
| Retargeting | bone lengths kept within 1e-9; a retargeted standing pose keeps both feet within 2 cm of the ground | unit tests |
| Locomotion quality | foot slide <= 0.25 px, penetration <= 0.5 px, reach violations 0, knee limits 0 on every humanoid walking a generated course for 60 s | as the existing gates |
| Natural | blind judge panel (both orders, a control): mocap-driven walk strips against the current procedural ones for the four humanoids, "which moves more naturally"; mocap picked in at least 80% of non-control answers | the point of the work |
| Transitions | at a clip switch, no joint moves more than 3 times its median per-frame movement of the surrounding second | smooth blending |
| Adapts | a 4 m/s headwind slows the walk by at least 10%; a poke moves the body at least 0.1 m and plays a reaction | physics leads |
| Real-time | 8 characters on the showcase page: p95 <= 40 ms in headless Chrome; clip data adds at most 2 MB gzipped | budget |
| Determinism | identical frames for a seed in Node and Chrome | |

## Batches

- **A. Data and retargeting:** fetch and convert the curated clips, the clip format, retargeting to the knight, rogue,
  dwarf and wizard, an offline render of retargeted walk and idle cycles; the retargeting and licence gates; an early
  judge panel on walk strips (does it already read as natural?). Review.
- **B. Playback:** motion matching with inertialized blending, foot locking and terrain IK, the physical body
  leading; quality and transition gates on terrain. Review.
- **C. The world:** humanoids switch to mocap playback, activities set goals, wind, pokes and quakes act through the
  body; the remaining gates. Review, then release.
