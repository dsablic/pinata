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

## Character style

The same clip should not make every character move alike (user, 2026-10-30). Each character's retargeting carries a
declarative `style`: per-joint amplitude (scale a joint's rotation about its mean in the clip, so a rogue swings its
arms wider and a knight keeps its shoulders stiff), per-joint posture offsets (a dwarf's forward hunch, a wizard's bowed
head), playback rate and stride, which takes it draws from or blends between, and seeded small variation so two
characters on the same clip never move in lockstep.

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
| Style | two characters on the same clip with different styles: their joint angle series differ by at least 5 degrees RMS on the styled joints; with the neutral style, retargeting is unchanged | parameters matter |
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

## Log

- **2026-10-30, batch A in progress.** ASF/AMC reader (`src/mocap/asf.ts`), clip format and conversion
  (`src/mocap/clip.ts`, `npm run mocap`), eight CMU takes in `motion/clips` (724 KB, 204 KB gzipped), retargeting
  (`src/mocap/retarget.ts`, `motion/humanoid.json`, each humanoid's `retarget.json`). Gates so far: existing outputs
  byte-identical; licence (each clip names its take, tested); bone lengths kept (error ~1e-15); standing feet within
  2 cm for rogue, dwarf and wizard (at most 0.9 cm). **Fail, recorded:** the knight's standing feet are 2.3 cm apart in
  height, because its right leg is 1.3 cm longer than its left and modelled stepping forward, and one vertical
  placement cannot put both down; the test is a todo until foot locking (batch B). Before IK, foot slide on the walk
  is 2.0 to 3.7 px, also for batch B. Remaining in A: character style, the strip render command, the early judge
  panel, review.
- **2026-10-30, plan change (user agreed):** character style moved into batch B, and the early judge panel replaced
  by one panel at the end of B on finished playback.
- **2026-10-30, batch B built.** Style (`src/mocap/style.ts`), retargeting split into rotations and assembly so
  blending works on rotations, a motion database per character with matching features (`src/mocap/database.ts`), and
  the player (`src/mocap/player.ts`): a light physical body (speed and heading gains, wind drag, shoves), motion
  matching every 5 frames with inertialized switches, root motion stretched to the body and drawn toward it, sole
  points held where they touch, feet on the terrain (tilted on ramps, lifted over stair edges ahead), the pelvis
  following the feet and kept within every held leg's range, feet in the air kept in range without moving across
  the ground, and two-bone IK. A ninth take (CMU 16_31, a walk starting from standing) was added, as no take started
  from rest. Gates, as tests (`test/mocap-playback.test.ts`): on generated terrain (stairs at 0.3 of the shortest
  leg), each humanoid walking, stopping and turning for 60 s on two seeds keeps slide 0 px, penetration 0 px, reach
  violations 0, knee limits 0, bone lengths exact (also checked by hand on ten more seeds: all pass); a 4 m/s headwind
  slows the walk by more than 10%; a shove moves the body more than 0.1 m; the neutral style changes nothing and two
  styles differ by more than 5 degrees RMS on the styled joints. The body's height between the feet is now a soft
  minimum, so it does not jump as the weight passes between them, which also puts both of the knight's feet within
  2 cm when standing: that test passes (it was a todo). Existing outputs byte-identical.
- **Fail, recorded: transitions.** At 34% to 56% of switches some joint moves more than 3 times its median per-frame
  movement of the surrounding second. Ordinary frames with no switch fail the same test at 32% to 48%: feet landing
  and lifting make movement lumpy, and the gate takes the worst of 30-odd joints.
- **2026-10-30, independent review of A and B** (assume the code is wrong). The math (quaternions, yaw conventions,
  FK against the CMU convention, inertialization order) checked out. Fixed:
  - **Critical:** a foot out of reach across the ground made the body's height minus infinity and then NaN for good
    (a dwarf over its speed, or shoved hard). Out-of-reach feet now set no limit, held ones step off, and the height
    is kept finite; a test pushes characters far past their legs and checks every joint is finite and the gates hold.
  - A step ended with a one-frame vertical snap (its lift was still 71% up on its last frame): the lift now lands
    with zero slope and the ground it left fades into the ground it goes to.
  - Nearly every footfall was a synthetic step, because held feet were let go only when they drifted, not when the
    clip lifted them: the player now reads the clips' contact flags (a foot is held only while its clip has it on
    the ground), and a foot the clip swings keeps 3 cm clear of the ground (real toes clear it by 1 to 3 cm, under
    the 2 cm the slide metric counts as touching). Lifts that follow the capture went from 0-20% to 75-88%.
  - A swinging foot's ground reference jumped to the ground under its animation (ahead of the foot during a step); it
    now rises and sinks at limited speeds, and a released foot's offsets fade smoothly over 0.25 s.
  - A one-end pin moved a held end; a foot with one end held and the other staying down now stays as it was.
  - The ASF reader refuses a root section it does not support instead of assuming the CMU one.
  After the fixes the quality gates pass on 8 seeds per humanoid, and switches are about as lumpy as ordinary frames:
  19% to 31% of switches over 3 times against 17% to 32% of ordinary frames. **Proposed replacement for the
  transitions gate, for the user to approve** (a different measure, not a tightening): the share of switch frames
  over 3 times is at most the share at ordinary frames plus 10 points.
- **Fail, recorded: the judge panel, round 1** (before the review fixes). Mocap picked in 75% of the answers on real
  pairs (gate 80%): the wizard, rogue and dwarf 6 of 6 each, the knight 0 of 6 (its mocap strip carries the sword
  arm stiffly out in front; the procedural one swings it). Controls left unseparated by 75% of judges, left picks
  56%. Two of the three judges gave identical answers, so the panel is less independent than three judges suggest.
- **Fail, recorded: the judge panel, round 2** (after the review fixes, new strips, new seed). Mocap again picked in
  75% of the answers on real pairs (gate 80%): the wizard, rogue and dwarf 6 of 6 each, every judge in both orders;
  the knight 0 of 6. Controls left unseparated by 92% of judges, left picks 56%. The knight's arm carrying the sword
  copies the empty-handed capture, so the sword sticks out in front and does not read as carried. Next: a style for
  arms that carry something (stiffer, held lower), declared per character, then one more round; batch B is otherwise
  done, and batch C (the world) can start once the user has ruled on the transitions gate.
