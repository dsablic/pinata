# Design notes

Implementation choices and the reasons for them. Code carries no comments: names and structure say what it does,
this document says why. Plans and their gates live in [`plans/`](plans); this file describes how things are built
as they stand now.

## Conventions

- No comments in code. Names say what a value or function is (`MARGIN_FROM_SURFACE_ENDS`, `surfaceBelow`); when a
  choice needs a reason, the reason goes here under the module's heading.

## The page as the world (`src/page/`)

Plan: [page world](plans/2026-10-31-page-world.md).

### Coordinates

- Page boxes are read in page CSS pixels (viewport rect plus scroll), so scrolling never changes them and surfaces
  are not rebuilt on scroll.
- Metres have x to the right and y up with the page's top edge at 0, so everything on the page has a negative height.
  This keeps the engine's y-up convention without needing the page's total height (which changes as the page lays
  out).
- `pixelsPerMetre` converts between the two; `scale` is CSS pixels per sprite pixel, so a character's sprite is
  rendered at `pixelsPerMetre / scale` pixels per metre and drawn scaled up with smoothing off.

### Marking (`dom.ts`)

- `data-pinata` on an element wins over the CSS custom property `--pinata`. Values: `ground` (the top edge is walkable),
  `wall` (the sides block), `none` (the element and everything inside it are ignored).
- `--pinata` is registered as a non-inherited property (`CSS.registerProperty`), so only elements a rule matches carry
  it: nested elements with the same class are each marked, a card's paragraphs are not, and `:root { --pinata: ... }`
  marks only the root.
- Not ground: elements with `display: none` or not `visibility: visible`, elements whose top edge is scrolled out of a
  clipping ancestor (`overflow` other than `visible`; the visible part of the edge is kept), and `position: fixed` or
  `sticky` elements, which move with the viewport and so have no fixed place on the page.
- The scan walks the whole body and reads every element's computed style once per scan. Scans run on load and on
  change only, never per frame.
- Change detection: a ResizeObserver on the root element and on every marked element; a MutationObserver over the
  whole document (head stylesheets included) for added and removed nodes, text edits and changes to `data-pinata`,
  `class`, `style`, `hidden` and `open`; scrolling inside any container (capture-phase scroll listener, the page's own
  scroll excluded); window resize; fonts finishing loading. Changes that touch a marked element (or its ancestors or
  descendants), and every added or removed node, rescan on the next frame. Other attribute and text changes rescan at
  most every 250 ms (`UNRELATED_CHANGE_DELAY_MS`), so a busy animation elsewhere on the page cannot force a full rescan
  every frame. Not detected: elements moved by CSS animations or transitions alone.

### Surfaces and walls (`surfaces.ts`)

- A ground element's top edge is one flat surface from its left to its right. A wall element gives two walls, its
  left and right sides, from its bottom to its top.
- `surfaceBelow` picks the highest surface spanning x that is not higher than the character's own height plus a step:
  a character under a shelf does not stand on the shelf.
- `heightUnder` turns that into the per-character ground function the motion code expects. Where there is no surface
  at all it answers a long way down (`DEPTH_WITH_NO_GROUND`, 1000 m) so a character over a gap falls rather than
  standing on nothing.

### Characters and the overlay (`page.ts`)

- Characters keep a reference to the element they stand on, not to a surface index: indices shift when elements are
  added or removed. After a rescan each character stays at the same share of its element's width. A character whose
  element is gone, or that found no ground at all, is placed anywhere on the page's ground when there is some, and
  until then is neither drawn nor hit.
- Only cast members with a skin live on the page: the procedural renderer is too heavy to run per character on
  arbitrary pages.
- Starting places are drawn with a seeded random generator, weighted by surface width, at least 0.3 m from a
  surface's ends (`MARGIN_FROM_SURFACE_ENDS`).
- Each character renders into its own sprite box, 1.6 times its height square (`SPRITE_BOX_IN_CHARACTER_HEIGHTS`),
  with its feet line at 85% of the box (`FEET_LINE_SHARE_OF_BOX`), through a camera 8 degrees above the horizon
  (`CAMERA_ELEVATION_DEGREES`): nearly side-on, so characters read against a flat page. The sprite is rendered once per
  facing and kept as a small canvas; scrolling only redraws.
- The overlay is one canvas in the top layer (a manual popover), so no transform, filter or stacking context on the
  page can move or cover it; browsers without popovers get a fixed canvas on the root element. It has
  `pointer-events: none` and `aria-hidden`, is sized in CSS pixels from the same numbers as its backing store (not
  `100vh`, which differs from the visible height on mobile), and its backing store is scaled by the device pixel ratio.
  Sprite pixels are drawn at a whole number of device pixels (the scale times the ratio, rounded) so they stay square
  on high-density screens. Characters outside the viewport are neither rendered nor drawn.
- Pokes are decided on a trusted primary `pointerdown`. When it lands on an opaque pixel of a drawn character, that
  event and the rest of the gesture (`mousedown`, `pointerup`, `mouseup`, `click`, `dblclick`, `auxclick`,
  `contextmenu`, for up to 800 ms) are stopped in the capture phase. Clicks from script or the keyboard, which carry no
  pointer, are never taken. While a modal dialog, an open popover or a fullscreen element covers the page, nothing is
  poked.
- With `prefers-reduced-motion: reduce` a poke registers but the character does not turn.
- `createPageWorld` returns the state tests read (`ground`, `characters`, `pokes`, `rebuilds`) and `destroy`, which
  removes the overlay and every listener and observer.

### Browser checks (`src/cli/browser-test.ts`)

- The checks drive the locally installed Chrome over the DevTools protocol with Node's own WebSocket: no test
  framework or browser package is needed, and CI uses the runner's Chrome.
- The test page lives in `test/pages/` and is copied into the built site only while the checks run, so it is never
  published.
- Every check names what it measured and must be able to fail when the behaviour it guards breaks.

## Motion (`src/motion/`, `src/math/`)

### Gait planner (`gait.ts`)

- `planGait` turns a root track into one `GaitFrame` per tick, both ends included: the root, a pelvis offset, the
  feet, the arm swings and the gait phase.
- Without `ground` the walking surface is the plane y = 0. `surfacePitch` (on a foot) and `pelvisPitch` (on a frame)
  are only set on terrain; both are radians, toe up and nose up positive.
- `initial` gives where each foot stands at the start, in `legsOf` order, so a new plan can continue from a previous
  plan's last plants; without it the feet start at the rest pose under the root.
- A foot's `toe` is the toe's body-local offset from the ankle at rest. Its `shape` gives how far the foot capsule
  reaches behind the ankle and past the toe, as fractions of the ankle-to-toe length, so footprints scale with the
  foot.
- A stopped walker stands still at the phase where, once every left-right pair of feet has had a landing, the first
  landing follows after which no foot has lifted off yet. The phase eases there at the reference cadence.
- The footprint is the ground height at evenly spaced samples from the back of the heel to the front of the toe.
- On one surface, the ankle stands on the line through the footprint's first and last samples, lifted further by
  however much any sample stands above that line (a convex kink where a ramp meets a flat run); the foot pitches
  with that line.
- Ground steeper than tan 60 degrees between two samples is a stair edge, not one surface. The plant is then nudged
  along the foot in 1 cm steps, up to 0.4 foot lengths either way, until the whole footprint is on one tread;
  failing that it stands flat on the highest sample.
- The lowest a swinging ankle may be is its sole, pitched like the foot, above the ground under every footprint
  sample by as much as the swing rises over flat ground (the step height scaled by the lift, none at lift-off and
  touch-down), so a swing clears steps between its plants.
- On terrain the body leans per frame: its base height is the mean height of the planted feet's soles, and its
  nose-up pitch is the front feet's soles against the hind feet's over the distance between their hips. A frame
  without a planted foot at either end keeps the previous value; both are smoothed over 0.15 s.
- `pitchLift` is how much a body pitch lifts a rest point rotated about the pelvis, so the reach check sees each hip
  where the pitched body puts it.

### Walker (`walker.ts`)

- The walker is a physical body rather than a planner: it has mass and momentum, planted legs hold it up and push it
  toward the commanded velocity (harder the more feet are down), it turns with a heading spring, its torso pitches
  with its acceleration, and wind and shoves move it.
- Each foot aims under its hip plus half a stance of travel, on the ground. It lifts when it falls too far from that
  aim (`trigger`, a fraction of the stride) or its leg nears full reach, provided no other gait group is mid-swing;
  legs with the same phase swing together.
- Each frame becomes a `GaitFrame`, so posing, IK and everything downstream work as for planned walking. The walker
  is deterministic.
- A `Command` is a forward speed along a heading (yaw radians); speed 0 stands still facing the heading.
- `WalkerTuning` units: `traction` is the most horizontal acceleration (m/s^2) the legs give with every foot planted;
  `speedGain` is how fast the speed error closes, per second; `turn` and `ride` (on the planted legs) are springs in
  Hz with damping ratios; `tilt` adds degrees of lean per m/s^2 of acceleration; `drag` is wind drag on the body per
  second.
- `push` is an instant change of the body's velocity (m/s), as from a shove; `wind` is the wind velocity (m/s) felt by
  the body, read every substep.

### Posing (`locomotion.ts`)

- `poseAt` gives body-local positions and transforms of every joint the rig names for one gait frame. The pelvis and
  upperBody move with the pelvis offset (and pitch on terrain), legs move by IK to their planned feet, and arms swing
  about the shoulder with their carried joints. Every other joint (attached joints, and appendages until their
  springs run) moves rigidly with its parent.
- Each leg joint turns with the bone that leaves it (the toe with the foot), by the smallest rotation from its rest
  direction.

### Inverse kinematics (`ik.ts`)

- `twoBoneIk` keeps the knee flexion within the given limits (degrees, positive toward the pole side, at least 0).
- `chainIk` places a chain of two or more bones with its first joint at `root` (default `joints[0]`) and its last at
  `target`; `joints` supply the bone lengths. Two bones use `twoBoneIk`, with the knee flexion held within the limits
  when given; all-negative limits put the knee on the other side.
- More bones use FABRIK in the plane through root, target and pole, started from the rest shape where its joints
  already bend to their sides and from a zigzag on the bend sides otherwise. It runs for at most 400 iterations and
  ends on a forward pass, so bone lengths are exact and flexion limits hold.
- A bend of 1 bulges a joint toward the pole, -1 away from it; flexion is positive when a joint bends toward its bend
  side. `missed` is the distance from the end to the target after the solve, so limits that make a target
  unreachable are reported.

### Appendages (`appendages.ts`)

- Every appendage moves with a damped angular spring toward each segment's rest direction relative to its parent,
  plus an optional oscillator on the first segment. The first segment's parent is the joint the appendage hangs
  from, so it turns with that joint.
- An appendage spring's natural frequency runs from 0.3 Hz at stiffness 0 to 3 Hz at stiffness 1; stiffness 1 is
  rigid.
- Each segment carries the rotation from rest to its current direction (its target's rotation followed by the
  smallest swing to where the spring put it), and its children aim through that rotation.
- Tips are integrated in world space at `substeps` steps per frame (8 by default), with the root joint, the parent's
  rotation and yaw interpolated between frames, and each tip is projected back to its bone length.
- Every appendage joint turns with the segment that leaves it (the tip with the last segment), as leg joints do.
- Appendages run parents first; after each, the joints attached below it are placed again.
- An appendage on a joint that turns starts moving with that joint's first-frame velocity; otherwise its tips start
  with the root's velocity.
- A `Force` is an outside acceleration (m/s^2) on a segment's tip given its velocity, such as gravity or wind drag.

### Pose sequence (`sequence.ts`)

- Each frame is posed on its own first (`poseAt`); the appendage springs then run over the whole sequence, since
  they carry state from frame to frame.

### Skating control (`skating.ts`)

- The control keeps the planned gait but places the feet relative to the root every frame, so nothing is planted in
  world space. Each ankle swings forward and back by stride / 4 · sin(2π (phase + 1/4)) under its hip and lifts while
  it moves forward relative to the body.
- The quarter-cycle shift puts the foot cycle in step with the planner's pelvis bob, and the ankle stays within 98%
  of the leg's reach of the bobbing hip so the legs are never locked straight. Root, pelvis, arms and phase come from
  the planner unchanged.

### Skeleton (`skeleton.ts`)

- A transform places a point relative to its rest position: posed = rotation · rest + translation, body-local. An
  absent rotation is the identity, and then posed = rest + translation exactly, so joints that never rotate keep the
  arithmetic they had before transforms existed.
- Parents: the pelvis is the root; upperBody joints hang from the pelvis and `attached` joints from the joint they
  name; each limb is a chain from its first joint, whose parent is the pelvis (or, for an appendage, its `parent`);
  an arm's carried joints hang from its last joint.
- `inherit` places every joint that is not driven rigidly with its parent, parents first, so a chain of attached
  joints follows the nearest driven ancestor.

### Character simulation (`character.ts`)

- `simulateCharacter` plans the gait, poses every frame and simulates the cape and chains on the posed body with
  the P3 conventions: `substeps` substeps per frame and frame 0 recorded before stepping. Frame i's pose is held for
  the substeps that end in frame i. Appendages swing at the same substep rate. Joints the rig does not move keep
  their rest positions.

### Metrics (`metrics.ts`)

- A sole point is planted when it is within 2 cm of the ground in this and the previous frame; sole points are the
  ankle and toe joints lowered by the foot capsule's radii. Planted counts are keyed by leg label.
- Leg labels name feet by side for two legs, by side and front or hind for two per side, and by side and a number
  from the front (larger rest hip z) for three or more per side. Arm labels number arms from the front only when a
  side has several.
- `kneeLimitViolations` counts joint-frames, over every intermediate joint of every leg, with flexion outside the
  leg's limits (default [0, 150] degrees) or a joint on the wrong side of its bend direction.
- `boneLengthError` covers every leg bone and every arm bone but the last.
- `rootSpeedError` does not trust the root: it measures each foot's advance along the path between its first and
  last plant in a steady segment, against the script speed. The path direction is the root's displacement over the
  segment. A foot or segment without two plants measures nothing and gives Infinity.
- Steady segments are each `move` after its first `accelSeconds`, minus any that overlap a `turn`.
- `alternationViolations` counts plants (geometric plants, timed at their first frame) by a leg other than the one
  whose phase comes next after the previous plant's leg; with two legs that is the same foot planting twice in a row.
- Balance: the body centre is the volume-weighted centroid of the parts whose joints all belong to the pelvis group
  (each part's volume at its midpoint), or the mean of those joints when no part qualifies. A frame is unbalanced
  when that centre lies more than 2 cm outside the convex hull of the planted sole points; frames without support
  count under `unsupportedFrames` instead. The hull is Andrew's monotone chain without collinear points, and a hull
  of one or two points has no inside.
- Appendage bone errors count non-finite lengths as Infinity.
- Frame hashes are SHA-256 over each frame's joint positions in joint-name order.

### Script (`script.ts`)

- The root track integrates the script's speed and yaw with a midpoint rule at 1/960 s steps, precomputed once over
  the whole script; a lookup adds one partial step from the nearest whole step below it.

### Matrices (`src/math/matrix.ts`)

- Matrices are 3x3 rotations stored as rows. `yawMatrix` rotates about y the same way `toWorld` does.
- `between` is the smallest rotation taking one unit vector onto another; for opposite vectors it is a half turn
  about an axis at right angles to them.
- `toAxisAngle` returns the axis [1, 0, 0] for a (near) identity rotation. `interpolate` turns about the single axis
  that takes a to b.
- `eulerXyz` rotates by x, then y, then z about the fixed axes (Rz · Ry · Rx), as ASF and AMC files compose them.
- `fromQuaternion` normalizes the quaternion [w, x, y, z] first; `toQuaternion` returns w >= 0.

## Motion capture (`src/mocap/`)

### `asf.ts`

- ASF lengths are read in the file's length unit (inches divided by `length`) and become metres; angles become
  radians. Only `deg` angles, `XYZ` axis order and a root with order `TX TY TZ RX RY RZ`, axis `XYZ` and orientation
  `0 0 0` are supported; anything else is an error rather than a silently wrong skeleton.
- A bone's `axis` is C in the ASF convention: its global rotation is the parent's times C · M · C⁻¹, where M turns by
  the frame's channels in the bone's dof order. Missing channels count as zero, so partial AMC lines still pose.
- Bones are listed parents first, starting from the root, so forward kinematics is one pass in order.

### `clip.ts`

- A clip stores, per frame, the root position (height above the ground, horizontal from the clip's start), a heading
  (yaw) and every bone's global rotation from rest as a quaternion [w, x, y, z], rounded to four digits to keep the
  committed JSON small.
- Conversion keeps every (source fps / clip fps)-th frame; the source rate must be a whole multiple of the clip's.
  Dropped bones (fingers) take every bone below them with them.
- The heading is the root's facing averaged (as sine and cosine) over half a second each side, so the sway of the hips
  during a stride stays in the body rather than turning the path.
- The ground is the lowest point either foot reaches in the take. A foot is in contact while its ankle or toe tip is
  within 3 cm of the lowest that point gets and moves slower than 0.45 m/s across the ground.
- The source foot points (`ltibia`, `ltoes`, `rtibia`, `rtoes`) and their lowest heights are shared with retargeting,
  which measures each foot's clearance from the same floor.

### `retarget.ts`

- `aim` joints point their limb bone (to the next joint of the limb) where the source bone points, keeping the
  character's bone lengths; legs and arms are aimed because their rest poses differ from the source's. `turn` joints
  copy the source bone's turn from rest (pelvis, spine, head, feet). `hang` re-parents joints while retargeted, so a
  visor follows the head. Every other joint moves rigidly with its parent.
- The pelvis must turn with a source bone; an aimed joint needs a next joint in its limb to point at.
- Rotations are taken relative to the clip's heading, so the root carries the facing and the body stays body-local.
- The root path scales by the ratio of the character's left leg (hip to ankle) to the source's, measured from the
  bones the leg joints aim, times the style's stride.
- The body is lifted so the feet stand as far above the ground as the source's, scaled. The lift is a soft minimum
  over the feet (weights fall off over 1 cm): the foot nearer its planted level counts most, and the height does not
  jump as the weight passes from one foot to the other.

### `style.ts`

- `amplitude` scales a joint's movement about its mean rotation in the clip (1 unchanged, above 1 wider, below 1
  stiffer); `offset` turns a joint by fixed degrees in the body frame (a forward hunch is a positive x on the chest);
  `variation` adds a fixed, seeded offset of up to that many degrees to every aimed or turned joint, so two characters
  with one style still differ; `rate` scales playback speed and `stride` the length of the path.
- The mean rotation is the normalized sum of the quaternions, each turned to the first one's hemisphere.

### `database.ts`

- Every clip is retargeted to the character once; its assembled ankles are kept per frame for matching.
- Features are in the frame of the root at that moment: the root's position and facing (sine and cosine of the turn)
  8 and 16 frames ahead (a third and two thirds of a second at 24 fps), its velocity, and each ankle's position and
  velocity across the ground. Facing and ankle positions weigh 1.5, ankle velocities 0.75, the rest 1.
- Each feature is divided by its spread over the candidates, so features in different units weigh alike.
- A frame is a candidate when the full path ahead of it lies in its clip. A clip that ends standing still (root slower
  than 0.15 m/s over its last quarter second) offers every frame, its path held at the end, so its end can be matched
  as a stop and its last frame held.

### `player.ts`

- A light physical body (velocity and heading with gains, air drag from the wind, shoves) follows the commands, and
  the animation follows the body: motion matching picks the clip frame whose path ahead, velocity and feet best fit
  what the body is about to do.
- The legs can always out-push the wind (drag is capped at 80% of their acceleration), and a body told to stand holds
  its place three times harder.
- Matching runs every 5 frames and whenever a clip runs out. A jump to within 3 frames of the playing frame is not
  taken, and the playing frame's cost is lowered by 0.15, so playback does not jump for nothing.
- Switches use dead blending: the old motion carries on from its last frame at its own velocity, slowing to a stop over
  0.2 s, and fades into the new clip, so neither pose nor velocity jumps.
- Playback speed stretches between 0.8 and 1.25 to follow the body's speed. The animated root moves by the clip's
  own root motion and closes 12% of its gap to the body each frame, in position and heading.
- Each foot's sole ends (heel and toe tip) are held where they touch the ground: the clip says when a foot is down,
  the height (within 2.5 cm) says which ends touch. While both ends are held the foot's rotation is frozen.
- A held foot further than 15% of its leg's reach from its animation is pulled off and steps across, rising by 15% of
  the reach; a released foot rejoins its animation over 0.25 s. A step clears both the ground it left and the ground it
  goes to, the first fading into the second.
- Ends that stay within 2.1 cm of the ground from one frame to the next do not move across it, held or not; this stops
  slow sliding between hold and release.
- A swinging foot keeps its ends 3 cm clear of the ground (real toes clear it by 1 to 3 cm), easing in and out at
  0.4 m/s.
- A foot's ground reference is the ground under its held end, or, while swinging, the highest ground under its ends
  now and 0.2 s ahead, which it rises to at 1.5 m/s and sinks to at 1.2 m/s; where the foot actually is, the ground is
  kept below it when it is placed. This lifts feet over stair edges ahead without snapping.
- Near the ground (below 12 cm) a foot tilts to the ground under it about its heel, in proportion to how low it is;
  ground steeper than 60 degrees between heel and toe is a stair edge and does not tilt it.
- The pelvis follows the lower foot's ground with a 0.12 s time constant.
- Held feet set how high the body may stand: low enough for each to reach (98.5% of the leg), high enough that none
  folds past 140 degrees of knee flexion (legs of more than three bones: a quarter of the reach). A held foot no height
  can reach steps off; when two held feet cannot both be kept, the one limiting reach steps off.
- Feet in the air ask the body to rise where they would fold and lower where they could not reach, as far as the held
  feet allow; the body eases there, lowering (0.06 s) faster than it rises (0.12 s), and the held feet's range is kept
  every frame.
- A foot in the air keeps its place across the ground and rises or sinks to stay within the leg's range (folding at
  most 148 degrees), never into the ground. Out of reach across the ground and clear of it, it is drawn in to 97% of
  the reach; it is moved across the ground only where no end stays down, so it cannot slide.
- The legs are solved by IK last, so the reported pose always has the character's bone lengths.

## The world (`src/world/`)

### `world.ts`

- Each character lives its own day: it picks an activity by weight, and each step of the activity becomes a short
  plan, a root track planned into footsteps on the terrain from where its feet stand, so plans join without a jump.
  The world is deterministic for a seed.
- Characters keep 1 m from the world's ends; turns smaller than 0.05 rad are skipped.
- The upper body has life: a damped lean spring toward the body's forward acceleration (looking a few frames ahead in the
  plan for anticipation), its turning and the wind, plus a slow sway while standing; a squash at footfalls; breathing;
  and a head that lags on its own spring. The lean pivots about the pelvis and never moves the legs.
- A character with a motion database moves by motion matching instead of planned footsteps. Its steps become the same
  moves as for planned characters, each carried out as commands to its player, which the wind pushes.
- A captured walk counts as arrived within 8 cm, or within 30 cm once stopped (below 0.05 m/s), or 3 s past its time;
  it slows toward the target at 1.5 per second and steers back to its lane while further than 30 cm away. It keeps
  facing along the walk afterwards. A turn may run 1.5 s past its time.
- A poke shoves a captured character away by 1.8 m/s, but repeated pokes do not add up past 2.5 m/s; its startled walk
  goes away from the poke too. At most 8 finished moves are skipped in one frame, so a run of empty moves cannot hang.

### `config.ts`

- The world config holds everything that is tuning rather than mechanism; `site/world.json` is the showcase.
- Stair rise is a fraction of the shortest leg in the cast and stair tread a multiple of the longest foot, so every
  character can climb every flight and fit a foot on a tread.
- `dress` says how to draw a member's simulated cloth (material and radius of the cape and each chain) and which fixed
  mannequin parts the cloth replaces.
- A glyph not listed in `glyphs` draws as the first one.

### `bundle.ts`

- A bundle is a whole world in one file for the browser: the config and every member's mannequin, style and rig as
  written, plus motion capture for the members it names. It is validated the way loading the packages is, and errors
  name the member and the file they are in.
- A member's motion file is read only for its cape and chains; its script is not used, since the world plans its own
  walking.

### `terrain.ts`

- Terrain is a side-on profile along x of flat runs joined by ramps and stairs; depth (z) does not change the height.
- The seeded generator is mulberry32: small, fast, and the same sequence on every platform.
- Flat run heights are whole multiples of a height step (default half the largest rise). Flights longer than six steps
  become ramps where ramps are allowed; with no slope allowed every transition is stairs, and with no room for two
  heights the course is one flat run.
- Treads are at least 0.28 m, and at least the longest foot on the course, so a foot fits on one tread.

### `track.ts`

- Walks ease in and out over 0.6 s (less for a walk too short to reach its speed), so a walk of distance d at speed v
  takes d / v plus the easing time and covers exactly d; turns ease over their seconds.

### `render.ts`

- The canvas is sized from the terrain's extent, the walkable band's depth and the tallest reach in the cast: a
  character's farthest joint plus its thickest part plus the full length of its cape or chains, which can swing
  anywhere.
- Each character is rendered live in its own box that follows its root, keeping its own temporal hysteresis, and the
  boxes are drawn back to front. Characters with a skin draw with it unless skins are switched off; the skin draws its
  own cape.

### `page.ts`

- A click pokes the character with a joint nearest the click, not its root: the root sits at height 0, below the feet
  on a hill.
- The environment sliders write into the running world, which cloth reads every frame, so the weather changes live
  without rebuilding the world.

### `yaw.ts`

- Turning by a yaw and the shortest signed angle between yaws live once here and are shared by the world, the
  renderer and motion-capture playback.

## Rendering (`src/raster/`, `src/style/`)

### gbuffer.ts

- Each pixel's samples trace the primitives in order of where the ray enters their bounding spheres, and stop once
  the nearest hit lies before the next entry: a primitive can only be hit inside its sphere. Equal hits go to the
  lower part index, as a plain scan in index order would choose, so the result is the same as tracing every
  primitive.
- A ray that starts inside a bounding sphere enters it at 0.
- Only the pixel rectangle that some primitive's screen disc can touch is traced; pixels outside it get no samples
  and resolve to empty, exactly as a pixel with no hits does.
- With the previous frame's buffer, a pixel keeps its state while its coverage is within a hysteresis band
  (`COVERAGE_HYSTERESIS`) of the threshold, and keeps its part while that part is within `STICKY_SAMPLES` samples of
  the winner, so edges and part boundaries do not flip back and forth as a slow motion hovers on them.

### rotsprite.ts

- Rotation that keeps pixel art clean (RotSprite): the sprite is scaled up 8x by three Scale2x (EPX) passes, which
  round diagonal lines instead of blocking them, rotated there with nearest sampling, and scaled back down with a mode
  filter, so every pixel keeps a colour of the sprite and thin lines stay one pixel wide. Sprites are grids of palette
  characters with `.` for transparent.
- Scale2x turns each pixel into four, rounding corners where two neighbours agree. The 8x sprite is cached per grid.
- Angles are counter-clockwise on screen with y down, as the renderer measures bone angles, about the sprite's pivot;
  the result's pivot pixel sits on the original pivot pixel. Sines and cosines within 1e-12 of 0 or 1 are snapped, so
  exact quarter turns are exact.
- The mode filter breaks a tie to the centre sample, then to an opaque colour, then by character order.
- The result is cut to its opaque pixels, keeping the pivot's place.
- `rotateNearest` is the plain nearest-sampled rotation the first renderer drew, kept for comparison and for the
  jaggedness gate.
- Jaggies count pixels that break clean pixel-art lines: orphans (an opaque pixel with no 8-neighbour of its colour)
  and the extra pixel of an L-step (a 2x2 block with three pixels of one opaque colour whose fourth is transparent or
  another colour, where that colour does not fill the 4x4 neighbourhood around the block: a doubled step on a thin
  line).
- `cleanRotation` samples RotSprite at the centre of each block and tries every sub-pixel offset of the sample grid
  (as the original RotSprite searches offsets), keeping the one with the fewest jaggies among those whose colours each
  keep their area within 15% (`AREA_TOLERANCE`, plus one pixel) of the source, so detail is never dropped to look
  clean; when no offset keeps them all, the one that strays least wins. Offsets are symmetric about the pivot pixel's
  centre, so a mirrored sprite finds the mirrored best. Exact quarter turns are returned as they are.

### skins.ts

- Limb rotation: `nearest` (the default) snaps to 22.5 degrees and samples the nearest pixel; `clean` snaps to 11.25
  degrees and rotates with RotSprite. With `clean`, each part's last step is kept between frames (`angles`) and a bone
  must turn a quarter step past the middle of two steps (`HYSTERESIS`) before it moves on, so a bone near the middle
  does not flicker.
- Eight-direction skins take the character's yaw and keep the chosen view's sector between frames, so the view
  changes with hysteresis. A part shows the chosen view's sprite, or its counterpart's mirrored in a left-facing
  direction, fitted to the bone's on-screen length; one-view skins show their own sprite.
- A mirrored two-joint part turns its unmirrored sprite by the mirrored angle and flips the result, so left- and
  right-facing directions are exact mirrors of each other.
- Clean rotations are cached by sprite, pivot and step; at most 4096 are kept, oldest dropped first.
- Eight-direction skins also get inner lines and darker far limbs; one-view skins render as they always have.
  - Of each left and right pair, the one more than 5 cm deeper (`FAR_DEPTH`) than its counterpart is drawn a shade
    darker.
  - Inner lines are drawn as a pixel artist draws them where one part overlaps another: wherever a part's pixel borders
    an earlier (farther) part it does not share a joint with, that farther pixel takes its next shade down. Parts that
    share a joint join without a line.
  - A colour's next shade down is the darker palette colour nearest in hue and saturation (the colour less its grey),
    with the step closest in brightness breaking ties; a colour with nothing darker keeps itself.

### stylize.ts

- Selective outlines leave single pixels where the bordering part changes for one pixel, so outline pixels whose
  colour no neighbouring outline pixel shares take the most common colour of their outline neighbours (ties go to the
  lowest colour value, so the order of values does not matter). Each pass reads from a copy, so the result does not
  depend on scan order.

### views.ts

- The facing seen from the camera is measured across the ground, so the camera's tilt does not move the sectors'
  edges: 0 faces the viewer, +pi/2 faces screen-right, +-pi faces away.
- Views come from eight 45-degree sectors (-4 and 4 are both the back; negative sectors are mirrored). With the
  previous sector, the view changes only once the facing is 10 degrees past the edge between the two (`HYSTERESIS`),
  so a character turning slowly does not flicker between views.
- A part's counterpart swaps `Left`/`Right` in its name, or a trailing `L`/`R`.
- Mirroring a two-joint sprite, drawn along its bone, flips it top for bottom (the bone's direction is set by the
  joints); an upright sprite flips left for right.
- A two-joint sprite is fitted to its bone's on-screen length by keeping the end caps past each pivot and resampling
  the columns between the pivots (repeated or dropped evenly). Within a pixel of the drawn length it is left as is; it
  is never shortened below 60% (`MIN_FIT`) of its drawn length, since a shorter foreshortened limb reads as a spike.

## Cloth simulation (`src/sim/`)

### body.ts

- Compiled posed parts are cached by the identity of the pose object.

### cloth.ts

- Every cape pin references `anchorLeft`: offsets are body-local, so one joint is enough because `checkCapeAnchors`
  requires both anchors to move rigidly together.

### solver.ts

- `step` advances one substep; `t` is the time at its end, where the pinned particles move to the root pose and the
  wind is sampled. The caller loops substeps.
- With `pose`, the collider and pins use that body-local pose instead of the rest mannequin; it must return the same
  object for every `t` within a frame so the collider is compiled once per frame. With `transforms`, a pin's offset
  also turns with its joint's rotation.
- Each constraint is solved once per substep, so its XPBD multiplier starts at zero and never needs storing.

### metrics.ts

- Pinned particles (inverse mass 0) are placed by the root, not simulated, so their penetration depth, and that of
  their constraints, is recorded as 0. Penetration is also measured at the midpoint of each constraint.
- Swing angles are the pendulum angles of the hem centroid about the anchor in body-local space, with
  d = R(-yaw)(hem - anchor): forward = atan2(d.z, -d.y), sideways = atan2(d.x, -d.y).
- Settle time runs until the frame-to-frame peak particle speed drops below the threshold and stays below for the
  rest of the recording; Infinity if the last frame is still moving faster.
- Lag is the frame of peak sideways swing in [turnStart, turnEnd + 1 s] minus the frame of peak body angular velocity
  in [turnStart, turnEnd]; the first frame wins ties, and it is -1 if either window is empty or the swing peak is
  below `minPeakDegrees`.
- Wind alignment counts a frame with no hem displacement as 0.

### render.ts

- Cloth is drawn as thin capsule parts, one joint per particle (`cape.<index>`, `chain<n>.<index>`), expressed in the
  frame of a given root. They are for drawing only, never colliders.

## Diagnostics (`src/diagnostics/`)

- The footprint trace looks from above in the right-handed Y-up frame with the walker heading up the image: +x is on
  the left, +z up.
- The locomotion pixel strip uses one camera for every cell, centred on the root's horizontal position at the middle
  frame, so the character moves across the strip.
- The body-frame onion skin's `horizontal` 'z' (the default) is a side view with the body's front to the right; 'x'
  is a front view with the body's +X to the right.
- Flicker counts pixels that are colour A at k-1, another colour at k and A again at k+1, as a share of the
  silhouette at k; the worst frame counts.
- Part area jump skips parts under `MIN_PART_PIXELS` in either frame and frames where the part's bounding box moves by
  a pixel or more, so it measures shimmer rather than motion.

## Live runtime (`src/runtime/`)

### artifact.ts

- A live artifact is one JSON file with the package's mannequin, style and rig as written, and its behaviours. It
  carries no motion script, materials or cloth, which only offline renders use. It is validated the way loading a
  package does, and errors name the part of the file they are in.

### behaviours.ts

- The rope is tied to a joint plus an offset in rest space (the hook). Legs hang limp as spring chains with their own
  stiffness and damping.
- Masks are checked against a rig separately (`maskJoints`): `body` is the pelvis and upper body, a limb name its
  joints, a joint name its subtree.

### hang.ts

- The body hangs from a fixed anchor on a taut rope, with a twist spring about the rope. Each step is semi-implicit
  Euler followed by the rope constraint, which keeps the hook on the rope's sphere and removes velocity along the rope.
- A hit is an instant change of the hook's velocity and the twist rate; a drag holds the hook at the point and stops
  it.
- The body's rotation tilts its up axis toward the anchor, after the twist about it.

### character.ts

- A live character hangs from a rope and is driven one frame at a time by a behaviours file: swing and twist from the
  rope, limp legs, mane and tail as spring chains, behaviours as forces and offsets, and events such as hits. The
  same calls in the same frames give the same frames.
- Every leg and arm hangs limp: it becomes a spring chain from its first joint, like an appendage.
- Settings are read every step, so a demo page can change them live.

### director.ts

- A new behaviour fades in over `blend` seconds while the previous ones fade out over the same time. Offsets move
  joints directly, so they fade over at least 0.2 s (`MIN_OFFSET_BLEND`) even on a zero blend.
- Periodic primitives run on the shared clock, so a wave two behaviours share carries on across a switch.
- Behaviours with `then` hand over after `duration`; events in a behaviour fire once, at their time after it starts.
- Reduced motion scales amplitudes, impulses, spins and turns by 0.4 and stretches periods by 1.5.

### render.ts

- Live frames are drawn with a fixed camera: the anchor stays at `anchorAt`, the rope is a thin part from the anchor
  to the hook, decals turn with the body, and each frame passes the previous one's buffer to the rasterizer for
  temporal hysteresis.
- `frameHash` is FNV-1a (32-bit) over the pixels, so it runs the same in Node and in the browser.
- Dragging picks the point under the pointer at the hook's depth.

### browser.ts

- The simulation steps at a fixed rate on the animation clock; a late frame catches up by stepping without drawing.
  Each step is drawn with `putImageData` and scaled up with crisp pixels by CSS.
- A click on the character hits it from that side; dragging it pulls the rope and letting go swings it from there.
- `<pinata-character>` is driven by `pinata` custom events on the element or the window, honours
  `prefers-reduced-motion` unless `motion="full"`, and covers only its own box.

### showcase.ts

- Settings live in the running character; samples and reduced motion need a new one, so the sliders are carried over.

## Claude Code mod (`mods/pinata/`)

- In image mode the full 128x140 frame is scaled into the pane; in raster mode it is drawn at a smaller character
  size, one column per pixel and one row per two pixels. Two rows are kept for the caption.
- Terminal images are used where the terminal draws them (kitty, Ghostty, iTerm2 3.5+), half-block cells elsewhere.
  A blit refused because the Image would draw its alt text (no image protocol, or tmux holding images back) falls
  back to cells.
- The repository is found two folders up when the mod is loaded from the repo's `mods/pinata`, at a fixed checkout path
  otherwise.

## Formats (`src/formats/`)

### Validation helpers (`validate.ts`)

- Every validator returns `{ value?, errors }` and collects every problem, each with a path into the input, instead
  of stopping at the first; the value is only returned when there are no errors.
- Paths join with `.` from an empty root; an empty path prints as `(root)`.

### Schemas (`schema.ts`)

- A schema is a declarative description of a JSON value. Each kind says what it accepts, and an optional `note`
  is appended to the message so the message also says what the value is for.
- A union is picked by a tag field (`by`); each case lists its fields and which of them may be left out.
- Each problem is reported once, with its path.

### Character packages (`character.ts`)

- `character.json` names the other files (defaults `mannequin.json`, `style.json`, `rig.json`, `materials.json`,
  `motion.json`); names must stay inside the character directory.
- Each file is validated with its own format's validator, then the files are cross-checked against each other.
- Every error's path starts with the name of the file that has to change (`file: path`), so a cross-check error
  points at the file the author must edit, not at the file where the problem was noticed.

### Rigs (`rig.ts`)

- `attached` maps a joint to the joint it moves rigidly with (`{ joint: parent }`).
- A leg without a `phase` steps at 0 on the left and 0.5 on the right.
- `resolveRig` fills each leg's phase and bend from the rig's template, ordering the legs of a side by the rest hip
  z of the mannequin, so the order of legs in the file does not matter. A rig without a template is unchanged.
- Errors name a limb by the path it has in the file it was written in: `legs[1]` for a legs and arms rig,
  `limbs[1]` otherwise.
- `minimumStance` is the smallest stanceFraction at which some foot is always planted: 1 minus the widest gap
  between leg phases. A smaller stanceFraction would leave the character unable to stand still.

### Limbs (`limbs.ts`)

- `rankFromFront` ranks values from the largest (rank 0); of equal values the later one ranks first.
- An unnamed limb is named after its kind and count (`leg2` for the second unnamed leg), skipping to the next free
  number when another limb already uses that name.

### Templates (`templates.ts`)

- A template fills the phase and bend a leg leaves out; explicit values win. A leg's position counts the legs of
  its side behind it by rest hip z (hind first): a left leg gets phase `position * phaseStep`, a right leg half a
  cycle later.

### Starters (`starter.ts`)

- A starter leg has its knee halfway down and `knee` metres forward (negative: backward), its ankle `splay` metres
  further out than the hip, and its toe `toe` metres ahead; each sole point sits on the ground.
- A starter's gait is the template's gait per leg length scaled by its leg length, with a step height of at least
  5 cm: a foot within 2 cm of the floor counts as planted, so short legs need the extra lift to leave the floor
  cleanly. Some starters carry tuned gait values over the template's so that they pass check.

### Skins (`skin.ts`)

- A v1 skin draws one view (`view: 'side-right'`, `parts`); a v2 skin draws every view in `views` and has no
  single-view fields.
- The views a v2 skin draws face screen-right where they are not symmetric: front, the front three-quarter view, the
  side, the back three-quarter view, and the back. Left-facing directions mirror them.
- Eight-direction parts may be `upright`: a two-joint sprite drawn standing, joint A at the top and B straight
  below it. The reader turns it to lie along +x from A to B, its top row being the left of travel: the upright
  sprite's right-hand column becomes the top row.
- `layer` draws parts on a higher layer over lower ones whatever their depth (default 0).
- `from` reuses another sprite, by part name in the same view or as `view.part`; the copy keeps its own `layer`.
  Chains of references are followed; a missing or circular reference is an error.

## Judge panels (`src/judge/`)

### Packets (`packet.ts`)

- A blind A/B panel shows each pair's `a` (the candidate) beside `b` (the reference). A control pair shows two images
  the judges should not be able to separate: two references of similar quality, or the same image twice.
- Every pair is shown in both orders, shuffled by a hash of the seed, under neutral names (`item-01.png`, ...); the
  key that maps them back must be kept out of the judges' folder.
- Each image is trimmed to its opaque bounding box, both stand on one baseline and sit centred in equal cells.
  `layout: 'stacked'` puts the left image on top, for wide strips.

### Scores (`score.ts`)

- A judge is consistent on a pair when they picked the same image (not cant_tell) in both orders.
- A judge leaves a pair unseparated (neutral) when they answered cant_tell in both orders, or picked the same side,
  and so a different image, in each. Controls are scored by the share of neutral judges.
- `leftShare` is the share of picks for the left image over all pairs: 0.5 means no position bias.

## Images and PNG (`src/image.ts`, `src/png/`)

- `imageHash` hashes an image's size and RGBA bytes; it lives apart from `image.ts` because it needs Node's crypto
  and the browser runtime does not use it.
- The decoder reads non-interlaced PNGs of any colour type and bit depth, scales samples to 8 bits and applies tRNS
  transparency (palette alpha, or the transparent grey or RGB colour).
- In an animated PNG every frame has the first frame's size and replaces the whole canvas (dispose none, blend
  source). The first frame is also the default image, so decoders without APNG support show it.

## Command line (`src/cli/`)

### Judge (`judge.ts`)

- The key is refused when it would land inside the packet folder after following symlinks, compared without case on
  macOS and Windows, so judges can never see it.

### Live stream (`live.ts`)

- Raster cells pack two vertical pixels per cell; transparent pixels take the terminal's default colour.
- The events file is read as whole lines of `<seq> <name>`; a line still being written is left for the next read.

### Stills (`stills.ts`)

- The static views show the cloth as it hangs in the middle frame of the first steady walk, in body-local space:
  the cloth has settled into the walk there and hangs where it does while the character moves.

### Locomotion hints (`locomotion.ts`)

- Foot-spacing advice is left out when `lateral` is `rest`, which ignores footSpacing.
- A knee-speed hint first suggests bending the joint more at rest when it is nearly straight there.

### Site (`site.ts`)

- The site needs the compiled browser code (`npm run build:web` first). The world config, every cast member's
  files and the motion capture of members that have a `retarget.json` are bundled into one file for the browser.
