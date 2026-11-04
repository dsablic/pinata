# Design notes

Implementation choices and the reasons for them. Code carries no comments: names and structure say what it does,
this document says why. Plans and their gates live in [`plans/`](plans); this file describes how things are built
as they stand.

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
- Hints ride on marked elements: `data-pinata-say` (words a character says on arriving there) and how much
  characters like to go there, from `data-pinata-attract` or the non-inherited custom property `--pinata-attract`
  (a number; 0 when missing or not positive).
- The scan walks the whole body and reads every element's computed style once per scan. Scans run on load and on
  change only, never per frame.
- Change detection: a ResizeObserver on the root element and on every marked element, each observed once from the
  scan that found it (re-observing after every scan would rescan every frame, since every newly observed element is
  reported straight away; that first report counts only if its size differs from the scanned box by over half a
  pixel); a MutationObserver over the
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
- A walker's ground function (in `walker.ts`) answers with that surface; where there is no surface at all it answers a
  long way down (`DEPTH_WITH_NO_GROUND`, 1000 m) so a character over a gap falls rather than standing on nothing.
  Asked from a point's own height, it sees surfaces up to 2 cm above the point (`SOLE_REACH`) as well as up to a step
  above the body: a foot on a ledge keeps the ledge, but a swinging foot does not see a rise it cannot climb.

### The surface graph (`graph.ts`)

- Nodes are the parts of surfaces a character can stand on: a surface minus where another surface hides it (one at
  most a step higher, or level with it and listed earlier, which is the one `surfaceBelow` would pick), cut at every
  wall that blocks a body (a wall taller than a step above the surface and starting below head height). So adjacent
  nodes always meet at an end, and the graph only needs to look past each node's two ends.
- A wall element's two sides cut out everything between them, so no node lies inside a thick wall.
- From an end that no wall closes, the node a step past it (2 cm) is found the way a falling body would find it: the
  highest node there not higher than a step above. Within a step up or down that is a walk; lower is a drop, kept up
  to the drop limit (6 m on the page) and only where the surface below runs on at least 0.8 m past the edge
  (`LANDING_ROOM`): a body walking off an edge is still moving when it falls, and would otherwise land past a short
  surface.
  Rises taller than a step have no edge: characters do not climb.
- Jump edges exist only when the caller gives a jump height and reach (`reach.jump`); without them nothing changes.
  From a node to another whose top is more than a step and at most the jump height above, in either direction, with
  a gap between the nearest ends of at most the reach (1 m on the page; a node that runs under the target has no
  gap). The edge's `at` is the take-off, in the take-off node: far enough back that the body is already above the
  target's top when it crosses the target's near end, with 30 cm to spare because the leading foot is that far ahead of
  the root (at 5 cm the foot went 20 cm into the ledge's face; `runUp` in `mocap/jump.ts`, from the arc's time to
  reach the top), and at least 10 cm back from the gap; the edge's `land` is 25 cm inside the target (its middle on
  a narrow one), where a body's feet still stand on it. An edge is dropped when the take-off is not on the node,
  when the speed the arc needs is over 3.5 m/s, when a wall stands where the arc is below its top and within a body
  of its foot, or when another surface lies above the target's top within the apex's head room, or when a surface
  whose top is between the two ends has the arc at or below that top somewhere over its overlap with the arc's span
  (a jump never rises through a card: the soles would be under its top, and the feet are lifted onto it in two
  frames; a low step under the descent, which the arc is already above, blocks nothing; the parabola is lowest at the
  ends of the overlap, so the two ends are the test). The head room, the arc and the run-up use the jump's
  clearance (`arcOver`'s default is `JUMP_CLEARANCE`, 10 cm, the one place it is set; 1 m for super jumps; the arc
  carries the clearance it was made with). Several jump edges
  between the same nodes (from either side) are chosen between like parallel drops, by nearness to the goal, and a
  path given the walker's x takes, for each jump, the take-off nearest to where the walker is (the far side's take-off
  walked a character through the whole page first). A jump edge is its own type (`JumpEdge`, with `land`). The cast's
  `placeAnywhere` (drop-ins) uses nodes only, so jump edges do not enter it; `canReach` in the diagnostics takes the
  character's jump when the cast has jumps on.
- Each edge carries `at`, the x to head for: 15 cm past the end into the next node (clamped to that node), so a
  walker crosses the end rather than stopping on it.
- Paths are breadth-first (fewest moves): pages have few surfaces, and fewer drops and steps read as more purposeful
  than the shortest distance. Where two edges join the same nodes (both ends of a platform over the floor), the one
  whose `at` is nearer the next target (the goal for the last edge) is taken.

### Walkers (`walker.ts`)

- A walker is one motion-captured player whose ground is the page's ground seen from its own standing height (the
  player's base), plus a wandering plan over the surface graph. Walls are not physical: walkers stay off them
  because no node spans a wall.
- Wandering: rest for 0.8-4 s, pick a reachable node weighted by width and a spot in it at least 0.35 m from its ends,
  then follow the path edge by edge (heading for each edge's `at` at walking speed, 1.1 m/s, east or west), and slow
  down over the last 0.5 m to the spot. The current node is the one under the root at the surface height under it;
  off course (it landed somewhere else, or was moved) it replans, and a leg taking over 10 s plus the time to walk its
  distance at walking speed gives up and rests.
- Activities: `rest`, `wander`, `visit` and `flee`; each start after the first rest is counted (`started`, for the
  liveliness gate), and a restart (`moveTo`) puts a walker back at rest. A walk ends `reached` only when it got to its
  spot; giving up (no path any more, a leg over 10 s, or a page change that removed its place) ends it unreached.
  Wandering picks a node weighted by its width times one plus its surface's attraction, and the rest after arriving
  lasts longer by half the attraction (1 + attract / 2 times), so attractive elements win both ways.
- While falling a walker makes no plans and commands no speed; walking off an edge it keeps walking until the fall
  starts.
- `dropIn` restarts a walker above a place (activity `drop`), already falling, so it falls onto it.
- With `jumps` on, the walker's graph has jump edges for a jump height of one leg length (the shorter leg's hip-knee-
  ankle chain: knight 0.70 m, wizard 0.79, rogue 0.44, dwarf 0.34), which is as high as a character can put its hip
  without folding; a share of 0.6 left the rogue and dwarf below a step, so they could jump nowhere. Only the page's
  cast turns it on; walkers made without it, and drop-ins, have no jump edges.
- `jumps` is a kind, `'leg'` or `'super'` (`jumpOf(rig, rest, kind)` in `mocap/jump.ts`), and the walker hands the
  resulting `{ height, reach, clearance }` to its graph and to its player, so both agree on what a jump can reach. A
  super jump reaches 6 m up and 2 m across, with an apex 1 m above the target's top instead of 10 cm: the demo and
  page layouts have rises of 3 to 5 m stacked directly over each other, and with a 10 cm apex a 5 m rise needs about
  2 m of run-up, more than the 1 to 2 m of floor beside a card; a 1 m apex needs about 0.7 m. The 6 m leap lands from
  an apex 1 m up, at 4.4 m/s, where the landing dip already scales. The crouch, take-off, arc shape and refusal are
  the leg jump's. `PageWorldOptions.jumps` (default `'leg'`) reaches the cast and every walker; the kind changes no
  random draw, so the default world is byte-identical.
- A jump leg walks to the take-off at walking speed, slowing over the last 0.5 m as for a goal, and when within 6 cm
  asks the player to jump to the edge's landing (x and the target node's height, in the player's coordinates). A
  refusal ends the walk unreached, like any leg that cannot go on. A poke in the crouch cancels the jump (the player
  stays down on the floor, the dip dying away); after take-off it is carried through and the walker replans on
  landing. A page change in the crouch changes what the launch checks against, so a jump whose target is gone is
  cancelled at the launch and the walker, whose place is gone, rests. `reached` is cleared when a walk starts. While
  the player is jumping the walker commands no speed; the frame's `jumpTo` is the surface id aimed at from the
  command until the landing, which is what the jumps gate counts.
  Landing anywhere else is off course and replans like any other.
- `visit` sends a walker to a place (a point on a surface) if a node holds it and the walker can reach that node;
  `reaches` answers the same question without going.
- A poke turns a walker round and sends it 1.5 m the other way on its node (to its middle on a node too narrow for
  the end margins).
- `shiftBy` carries a walker with the element it stands on without restarting its motion: the walker keeps an offset
  between the player's coordinates and the page's, applied to the ground the player sees and to every frame it
  reports. `moveTo` restarts the player at a new place. `setGround` swaps the ground and graph; the goal is kept when
  a node still holds it, and the route is planned again from there.
- The frame it reports has the world joints, the base, whether it is falling, the surface under it, and each foot's
  sole points with the player's planted flag, which the page records for the standing gates.

### Perception (`perception.ts`) and speech (`speech.ts`)

- An element is noticed when the pointer has rested on it for 300 ms (passive capture-phase `pointerover`,
  cancelled on `pointerout`) or when it gains focus (`focusin`, so keyboard focus counts; focus returning to the same
  element, as when the window is focused again, does not count twice). What is noticed is the nearest interactive
  element around the target (link, button, form field, `summary`, `label`, anything with `tabindex`) or one with
  words; resting on plain text or the page's background is not a request, and the overlay is never noticed.
- The place for a noticed element is under its centre: the top of the ground element it is inside, if any (a button in
  a card sends a character onto the card), otherwise the highest surface there not above the element's top (what it
  sits on). Its box is read on the event, never per frame.
- The page sends the nearest character (straight-line distance from where it stands to the place) that can reach it;
  none is sent with reduced motion. Each sending is listed (`visits`, with the words it carries) for the checks.
- When a visit ends at its place, the character says the words of the noticed element or its nearest ancestor with
  `data-pinata-say`; when any other walk ends at its spot, the standing element's words. Unreached walks say nothing.
  Words show for 2.5 s in a bubble drawn on the overlay above the sprite (system font, 12 CSS px); a bubble that
  expires redraws the overlay, so it also goes away when nothing steps. The overlay is `aria-hidden`, so words are
  decoration, not content.

### The cast (`cast.ts`)

- The page world's behaviour lives in a core with no DOM: characters, their walkers, the layout (marked boxes with
  hints, each under an opaque key: the element in the browser, an id in Node), rescans, stepping, visits and words,
  drop-ins, samples, sprite images. The browser shell (`page.ts`) scans, observes, listens and draws; Node tests drive
  the same core on recorded layouts.
- Characters keep the key of the element they stand on, not a surface index: indices shift when elements are added
  or removed. While falling they stand on nothing. After a rescan, a character whose element moved (by more than a
  millimetre) is carried with it, and put back inside it if the element shrank from under it; one whose element is
  gone falls to whatever is below. A character with nothing at all below it (after a rescan or on any step) is placed
  anywhere on the page's standing places (the surface graph's nodes, so never inside a wall). Characters wait,
  neither drawn nor hit, until the page has some ground.
- Only cast members with a skin and motion capture live on the page: the procedural renderer is too heavy to run per
  character on arbitrary pages, and walking over surfaces uses the captured player.
- Time is passed in (`advance(seconds, viewport, moving)`), at most three steps' worth per call after a stall.
  Walkers step at 24 fps on one clock, each character a share of a step later than the one before, so with four
  characters on screen their steps and sprite renders fall on different frames; the shares survive stalls. Without
  motion only time passes, so words still expire.
- Characters cannot climb, so a page drains them downwards. A character that has been on the same element for 30 s
  (longer by the element's attraction) drops in, at its next rest, from above onto another standing place with
  nothing above it up to where it starts: 2.5 m above the place, or 1 m above the top of the viewport when that start
  would be in view, so it falls in from off screen. A drop-in is not an activity start, and the element it lands on
  counts as visited only once the character walks on it. Words for a visit that ends in the same step are said
  before a drop-in can take the character away.
- Every character runs secondary motion (chains and cloth, see `secondary.ts`) each step, in the bundle's gravity and
  a wind of the page's choosing (`wind`, none by default). The body's height is handed to the cloth as the root's
  height, with the pose lowered to match: the cloth substeps follow the root, so a falling body moves smoothly
  through them instead of jumping a whole frame's fall at once (which pushed cloth through it).
- With `measure: true` every step's foot gaps in CSS pixels are kept (`samples`, `null` where nothing is under a foot).
- A sprite is anchored at the surface under the character, so a foot on that surface is drawn on its top edge
  exactly; while falling it is anchored at the body's base. Each character renders into its own sprite box, 1.6 times
  its height square (`SPRITE_BOX_IN_CHARACTER_HEIGHTS`), with its feet line at 85% of the box
  (`FEET_LINE_SHARE_OF_BOX`), through a camera 8 degrees above the horizon (`CAMERA_ELEVATION_DEGREES`): nearly
  side-on, so characters read against a flat page. A sprite is rendered only when it is drawn and its frame changed.
- Starting places are drawn with a seeded random generator, weighted by surface width, at least 0.3 m from a
  surface's ends (`MARGIN_FROM_SURFACE_ENDS`).

### The overlay (`page.ts`)

- The shell turns the scan into the cast's layout, passes noticed elements on as visits (with the words of the
  element or its nearest ancestor with `data-pinata-say`), advances the cast every animation frame (not at all under
  reduced motion), and draws its sprites. Every frame's main-thread time is kept for the cost check (`costs`); the
  frame loop schedules its next frame even when a step throws.
- The overlay's own style changes (its size follows the window) are ignored by the change detection.
- The overlay is one canvas in the top layer (a manual popover), so no transform, filter or stacking context on the
  page can move or cover it; browsers without popovers get a fixed canvas on the root element. It has
  `pointer-events: none` and `aria-hidden`, is sized in CSS pixels from the same numbers as its backing store (not
  `100vh`, which differs from the visible height on mobile), and its backing store is scaled by the device pixel ratio.
  Sprite pixels are drawn at a whole number of device pixels (the scale times the ratio, rounded) so they stay square
  on high-density screens. Characters outside the viewport are neither rendered nor drawn; each drawn sprite is kept
  as a small canvas until its image changes.
- Pokes are decided on a trusted primary `pointerdown`. When it lands on an opaque pixel of a drawn character, that
  event and the rest of the gesture (`mousedown`, `pointerup`, `mouseup`, `click`, `dblclick`, `auxclick`,
  `contextmenu`, for up to 800 ms) are stopped in the capture phase. Clicks from script or the keyboard, which carry no
  pointer, are never taken. While a modal dialog, an open popover or a fullscreen element covers the page, nothing is
  poked.
- With `prefers-reduced-motion: reduce` nothing steps (characters stand in their rest pose), no one is sent on
  visits, and a poke registers without turning anyone.
- `createPageWorld` returns the state checks read (`ground`, `layout`, `characters`, `samples`, `visits`, `costs`,
  `pokes`, `rebuilds`) and `destroy`, which removes the overlay and every listener and observer.

### The demo page (`site/index.html`, `demo.ts`)

- The site's front page is built on the page world: rows of cards (each card ground, neighbouring cards a step apart
  so a row is one walk), each row inset from the one below so its ends drop onto it with room to land, and a floor of
  tiles, one of them attractive. Words sit on cards, a button and a link; hovering or focusing them calls a character.
- Controls restart the world with another count or seed, or with super jumps (a checkbox; the default is jumps of a
  leg length, which only reach low ledges). Timing is shown only on request: text changing inside a
  ground card is a page change, which would rescan the page every second.
- `?measure` turns on samples; the world is exposed as `window.__pinata`.

### Checking the page world

Plan: [a faster, deterministic harness](plans/done/2026-11-02-page-harness.md).

- **Layout fixtures** (`test/fixtures/layouts/`, `fixture.ts`): the marked boxes, hints and interactive targets (with
  their words and the ground element they are inside) of the test page, the perception page and the demo at 1200 and
  390 px, as Chrome laid them out. `npm run layouts` records them again; marked elements need ids.
- **Scenarios in Node** (`src/diagnostics/page-scenarios.ts`, `test/page-scenarios.test.ts`): the cast runs on a
  fixture at exactly 24 steps per second with the fixture's seed, so results are the same on every run (a test).
  Events are made to happen: an element is taken away under a character, a target is noticed, a layout moves, a
  character is left on an island. Who can reach a place is worked out from the graph by the test, not taken from the
  cast. A minute on a layout takes about a second.
- **Measured gates** (`npm run gates`): the standing gate on every layout, printed as met or missed, in Node over
  60 s, or in Chrome over 20 s per page with `-- --browser`; tests assert only what must always hold (the scenarios
  bound mid-air frames at 1.5% as a guard against regressions).
- **Landings** (`src/diagnostics/landings.ts`, `npm run gates -- --landings`): every skinned character is dropped from
  0.6, 2 and 5 m onto a flat floor with the walker alone, seed 1, 3 s at the page's 24 steps per second, 54 pixels per
  metre. The floor is 0.6 m wide, narrower than a wandering goal needs, so the character rests before and after the
  drop instead of walking off at the landing. Knee flexion is 180 degrees minus the hip-knee-ankle angle, the larger
  leg, deepest within 0.5 s of the landing frame (the first not falling after falling). The pelvis dip is measured
  against the same character's pelvis height resting before the drop (median of 0.5 s), not against the height after
  landing, so a character that stays crouched still shows its dip. Sole depth is the lowest sole under the floor over
  the whole run, held to the page's 1 px planted tolerance. Recovery is the time from landing to the last frame that
  is not normal: normal is not falling, the pelvis back within 3 cm of its resting height, at least one foot planted,
  every planted foot within 1 px of the floor, no unplanted foot more than 20 cm up (a walking swing rises about
  10), and not every foot more than 3 px up; a character not normal in the last frame has not recovered. The pelvis
  and unplanted-feet conditions are there because without them a character crouched for good, or holding a foot half
  a metre up, would count as recovered. The gates are printed with the others and with `--landings` alone; tests
  check the knee angle and the recovery rule on hand-made frames, not the gates.
- **Jumps** (`src/diagnostics/jumps.ts`, `npm run gates -- --jumps`): every skinned character runs on the recorded
  jump page (`test/pages/jump-test.html`, layout `jumps`: a 22 m floor, a wall, and eight shelves at 18, 20, 23, 25,
  37, 39, 42 and 45 px, 0.33 to 0.83 m, so each character has rises up to and just above its jump height, with
  1.3 m shelves and gaps between them) and on six synthetic grounds (a floor 14 m long, with solid ledges, walls
  down to the floor): stairs of three steps with rises 0.2, 0.3, 0.4 and 0.5 m and 0.6 m gaps, single ledges, and
  rises of 1.4 m with a shelf 1.4 m above a ledge. 300 s each, the walker alone, seed 1. It visits each top in turn,
  returning to the floor after each, starting each trip once resting on the ground (the walker's own wandering
  jumps in between). A trip counts as a planned jump when the top needs one (no route without jump edges, one with)
  and is accepted or refused; it is a hit only if the walker ends resting on the aimed surface with every jump of
  the trip having landed on its aim. A refusal, a time-out (30 s), a short landing or a landing elsewhere is a miss;
  a trip that only reached its take-off is not a hit. A climb is a standing frame (base within 1 cm
  of the surface under it) whose surface is more than the jump height (and 2 cm) above the previous standing one,
  however it got there. The deepest sole is measured on the jump's frames (crouch to landing) against the surface a
  sole is over, within 20 cm above it, and held to the page's 1 px planted tolerance. The gate is met per character
  with at least 40 trips, 95% hits, no climbs and no sole under. The recorded layouts are also run for 60 s with the
  cast and their jumps counted from the samples (`jumpTo` and `surface`); they print only. Page-test, perception and
  both demos have rises of 1.5 to 5 m, beyond a leg-length jump, so no jumps happen there.
- **Jump takes** (`npm run gates -- --jump-takes`, not in the full run, so its output stays as it was): over the same
  runs as the jumps gate (the jump page and the synthetic grounds, one walker each), two gates per character. Walking
  never plays a jump take (`strayTakeFrames`): a run of consecutive jump-take frames must begin on a frame with a
  jump planned, and may go on after the jump ends (touchdown) for at most the take's landing (settle minus land, at
  the player's speed, plus one frame), so a take that never hands back to matching fails. A real crouch
  (`crouches`): for every planned jump, the pelvis drops at least 10% of the leg length below its rest height before
  the first frame in the air, and, relative to the pelvis, a wrist travels at least 15% of the arm length between the
  lowest pelvis and the first frame in the air. Rest height stands for standing: the characters' standing poses sit
  within 0.016 m of it (the wizard's 1.6 cm is 2% of its leg), which flatters the drop by that much. The standing
  gates' cast runs do not record clip names, so only the jumps' runs are checked for strays; a take that is not a
  candidate cannot be matched in the others by construction.
- **Super jumps** (`npm run gates -- --super-jumps`, also in the full run): each recorded demo and page layout (not the
  jump page) runs 60 s with `jumps: 'super'`. Met when at least 4 jumps are planned, at least 95% land on the surface
  they aim for, and no sole is more than 1 px under a surface in a jump (`deepestInJump`, from the samples' foot
  gaps). After the 60 s the run keeps stepping, for at most 5 s more, until every jump planned within the 60 s has
  resolved (a jump still unresolved then is a miss, and a jump planned after the 60 s does not count). The deepest
  sole is read on the frames of a jump and one frame either side (take-off and touchdown). A foot's gap is null when
  no surface lies at or below its soles within 20 cm; that is a sole over nothing, which is not under a surface, so
  null is skipped rather than read as zero, and the measure sees a sole at most 20 cm under a top (a sole that
  crosses that band within one frame is not seen). `countJumps` itself counts a jump in flight at the last frame as
  planned and not landed, for the leg gates too.
- A walker cannot hang in a super jump: the leg timeout covers the walk to the take-off, the crouch is 0.18 s and
  either launches or clears the jump, and a flight ends at touchdown (a void under the landing is the falling-too-long
  rule of the cast); the gate's settling shows every jump of a 6 m arc resolving within 5 s.
- **The browser suite** (`npm run test:browser`, about 30 s) checks what needs a browser: the scan against an oracle
  that reads elements directly, after load, scrolling, resizing, adding, removing, inner scrolling and text reflow;
  characters standing on live surfaces (lowest sole within 8 px: mid-stride feet are a few pixels up, and the precise
  foot gates are `npm run gates`'); clicks reaching the page; pokes (and nothing reaching the page), with modal
  dialogs, reduced motion and high-density screens; layout shift; layout reads and rescans while nothing changes;
  frame cost; hover and keyboard focus sending a visit; and that every layout fixture still matches its page. Suites
  (`page`, `screen`, `perception`, `demo`, `fixtures`) run together or one alone (`node src/cli/browser-test.ts
  <suite>`); an unknown suite name is an error.
- The checks drive the locally installed Chrome over the DevTools protocol with Node's own WebSocket (`chrome.ts`): no
  test framework or browser package is needed, and CI uses the runner's Chrome. Test pages live in `test/pages/` and
  are copied into the built site only while the checks run.
- Layout reads are counted by wrapping `getBoundingClientRect`, `getClientRects` and `getComputedStyle` after the page
  has settled; with nothing changing, a frame must read none.
- Gaps of `null` (nothing under a foot) count as off the surface.
- **The glitch survey** (`npm run glitches`, `glitches.ts`): every skinned character, rendered frame by frame for 15
  minutes: a minute on each of the four layouts, nine minutes of stress on three of them, and two stressed minutes in
  6 m/s wind. Stress takes the characters on the page in turn, one a second: a poke every 4 s (fast walks and turns
  on the spot), a visit to a lower element every 3 s (walk-off drops), and, at most every 5 s, the element under a
  character taken away for 2 s (a fall from height). An element is taken only when another lies below the character:
  with nothing under it the cast places the character somewhere else, and that jump and its reset cloth would be the
  harness's glitch, not the renderer's. Asked with `footprints`, the renderer reports for each part the pixels it
  painted, occluded ones included, as well as who owns each pixel, how many it painted, its length as asked and its
  sprite's drawn length; the survey judges any renderer that reports these, and flicker reads the images. Worst frames
  of each kind go to `reports/glitches/` as before-during-after strips, with `worst.txt` naming them.
  - Fragments test the connectivity of a part's footprint (eight neighbours) and count the visible pixels of every
    piece but the largest: a part painted under the torso is still whole, two strips are torn even where the torso
    hides the gap between them. Owners alone can't tell these apart, since a later part beside both strips looks like
    one covering them.
  - Pops use the painted count, so a part covered by a nearer one is not a pop; a part missing from a frame counts as
    none. Parts under `MIN_PART_PIXELS` are skipped, and a pop is counted once until the part is back.
  - Stretch is the length a part is drawn at against its sprite's drawn length. A fitted sprite is
    never drawn shorter than 0.6 of it, rounded to whole pixels (`fitted`), so a part held there is not short; a
    part drawn by the page's strip painter is drawn at the length it reports.
  - Blank frames, under half the run's median silhouette, are counted on their own: flicker divides by the current
    frame's silhouette, so one near-empty frame makes a window's flicker meaningless.
  - A part far from its usual fit in its view is reported but not gated: shoulder-to-shoulder parts (the dwarf's
    mantle, the rogue's scarf wrap) foreshorten from one pixel to two as the body turns within a view, which is
    geometry, not stretch.
  - Pop notes list the views from the frame before to the frame back, so a view change is told from a renderer pop.
  - Turns on the spot are a yaw change over 90 degrees within 1.5 s at a mean speed under 0.3 m/s (turns while
    walking average about 0.7); drops are the starts of falls.
- **The rendering panel** (`npm run rendering-panel`, `rendering-panel.ts`): blind pairs of the page's strip painter
  against the rotating painter (`CastOptions.painter: 'rotate'`, which draws the page with the per-character angle,
  length and anchor maps of the rotating painters), on the same motion. For each skinned
  character, the first survey run after 4 s holding a walk (`WALK_FRAMES` frames above 0.3 m/s on a surface), a turn
  on the spot (the survey's count, from its start to 4 frames after) or a fall (3 frames before take-off to 4 after
  landing) is the window, sampled evenly to `MOST_FRAMES`; no window is picked by hand, and a character or kind with
  none stops the build. A fall counts only when the character walked off a surface (12 steady frames on it, no
  drop-in activity): drop-ins from above are not the case the page's falls are judged on. Both scenarios are built
  with the same seed and stress and run every frame, since the painters keep state between frames, and their
  walkers' roots are asserted equal at every step. Controls pair the rotating painter's strip of a window with its
  strip one frame later. The panel's seed names the round; a new round takes a new seed.
  - A sampled strip shows a frame every few, so glitches that last one to three frames (pops, tears, blank frames)
    seldom reach the judges: the panel judges the look of ordinary motion, the survey the rare frames.
- **The game panel** (`npm run game-panel -- <LPC people dir>`, `game-panel.ts`): blind pairs of the page's walks and
  landings against hand-drawn game sprites, the quality gate of the natural-page-motion plan. Windows come from the
  rendering panel's machinery (`windowsIn` takes the finders), drawn by the page's strip painter at page scale and
  not enlarged: the judge build scales both sides alike (`scale` 4).
  - A walk is one stride cycle of two steps, from one planting of the first foot to its next, sampled to 8 even frames
    (the cycle's end is the next cycle's start, so it is left out). The cycle length is read from the planted flags,
    not fixed, since it changes with the character and speed; it must be 8 to 48 frames long, steady walking on a surface
    throughout, and seen from the side (the facing angle within 22.5 degrees of a right angle to the camera), as the
    page's characters mostly walk sideways and the references are side views. A cycle starts only once a landing has
    recovered: no step in the `LANDING_RECOVERY_SECONDS` (1 s) before it was falling, so a walker still rising out of a
    drop-in's dip is not shown.
  - A landing is 8 consecutive frames of a walk-off fall (the rendering panel's rule): the 2 airborne frames before
    touchdown, the touchdown, and the 5 after; a fall shorter than 2 frames has none. Landings are not required to
    be side views, so the facing may differ.
  - The references are frames 1 to 8 of the right-facing row of four LPC base walk sheets (frame 0 is the standing
    pose), cropped without scaling. Their licences forbid keeping them in the repository, so they are read from a
    given folder and written only under `reports/`. Each character's walk and landing take different references,
    rotating; the controls pair male with female and soldier with its recolour.
- **The jump panel** (`npm run jump-panel`, `jump-panel.ts`): blind pairs of each skinned character's jump drawn with
  the CMU jump takes against the same jump with the procedural crouch and dip, the quality gate of the jump-takes
  plan.
  The procedural version is the same world bundle without the `kind: 'jump'` clips (`worldBundle`'s `jumpTakes`
  option): the player falls back to the dip when the database has no jump takes, so nothing else differs.
  - A jump window is one planned jump: the walker's `jumpTo` is set from the command (the crouch's start) until the
    player's jump ends (the landing's end), recorded as `Step.jumping`; 8 frames sampled evenly across it, and at
    least 2 of them must be airborne (`falling`), so crouch, flight and landing all show. Each version takes its own
    start and end, since the take's jump is longer than the dip's. A jump before the 4 s settling time, or one cut
    off by the run's end, is skipped.
  - Both versions use the same run for a character: the runs (the jumps layout at its seed and seeds 1 to 3, then
    super jumps on the page, demo and narrow layouts, which `SurveyRun.jumps` selects) are tried in order and the first
    run where both worlds give the character a window is used. The jumps themselves differ between versions, since
    the timings differ and the wandering diverges. Controls pair a character's first takes jump with its second
    (the knight and the wizard), a pair that should come out can't-tell.
  - A character with no window in any run stops the build.

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
  The live world passes one each step; offline planning passes none, so its outputs do not depend on the weather.

### Secondary motion (`secondary.ts`)

- One module runs a character's secondary motion for both worlds: spring chains for the rig's appendages and the
  cloth (cape and cloth chains) of its scenario, from the character's body each frame, in the world's gravity
  and wind. The terrain world and the page cast both use it.
- A character's motion may bind joints to its cloth (`bind`), so the artist's cape, cloak, robe and scarf sprites
  swing and bend with the simulation. Each bound joint gets a curve: from the joint its drawn part starts at (the full
  mannequin's part ending at the joint, even one the world's dress hides), then down the cloth from its pin to the
  free particle nearest the joint, along structural links only (a link spanning two collinear links is a bend link,
  the diagonal of a right angle a shear link), each point the mean of a particle and its structural neighbours. At
  rest every point is moved onto the drawn bone, and the last onto the joint; points at or above the part's start are
  left out, so the curve does not double back. Each frame the curve keeps those offsets (turned with the body),
  turns at most 75 degrees from the drawn bone at its start and 40 at each point, and is scaled to the bone's drawn
  length, so a flung or bunched cloth does not stretch, fold or flip its sprite. The bound joint is the curve's end,
  and skins draw the part along the curve.
- The resting hang is the cloth after 3 s still in the rest pose, run with the world's own cloth step (its substeps,
  gravity and collision passes, no wind), since chains and capes are built straight and droop; `reset` starts the
  cloth from that hang.
- The page softens its cloth materials (`fabric`: air drag ×6, damping toward the body's motion ×0.2, bend
  compliance ×300): with the materials as measured, damping carried the cloth along with the body and stiff bending
  kept it flat, so capes and robes read as armour at page size. The terrain world and the reports keep the materials.
- The knight's plume is not bound: its sprite is a crest over the helmet.
- `reset` puts cloth and chains back to rest, for a character moved, re-placed or dropped in; `shift` carries them
  with a page element that moved. It also drops the cloth curves: the move happens after that frame's step, so the
  frame would otherwise be drawn with curves from where the character had been, and its cloth parts drawn off the
  sprite. Until the next step those parts are drawn as rigid bones on the new pose.
- Options the page sets and the terrain world leaves off, so the terrain world's outputs stay as they were: two
  collision passes per substep, eight more passes at the end of each frame (`settle`), and a full step on the frame
  cloth starts (otherwise it is only placed, and can start inside a body posed away from rest). Between them, no
  cloth particle sinks more than 0.5 cm into the body on the page's recorded layouts, where one pass let free cloth
  sink 3 cm.

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
  absent rotation is the identity, and then posed = rest + translation exactly, so joints that never rotate use exact
  arithmetic.
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

- A clip may carry `kind: 'jump'` (from its entry in `motion/takes.json`, validated against that one value): a jump
  take, played by the player and never matched while walking. A take entry may also give a `range` of source frames to
  keep, so a jump take is cut to about 0.3 s before its crouch through its landing settling.
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

- Jump takes are kept apart from the clips matching reads: `entries`, `candidates` and the feature spreads are built
  from the walking clips only, so adding a take changes nothing a walking character does. `jumpTakes` holds each
  take retargeted like any clip, with the phases cut from its contacts and its root height (scaled like the retargeted
  root path, leg ratio times stride, since the retargeted root drops its height): the crouch begins where the root
  first falls 3% below its height at the clip's start, the flight at the first frame with no foot down, the landing at
  the first frame after with any foot down, and the landing ends where the root is back within 3% of standing. A take
  that never crouches, flies and lands is an error.
- A take's play starts at the real crouch: 3 frames before the last frame of the root's final descent into the
  crouch's lowest point that is still within 1% of the height it descends from (the end of the last plateau or
  local maximum, found by walking back from the lowest point). Any dip and rise before it, and standing still, are not
  played, and the clips are cut so little precedes it.
- A take also stores its flight's run (root travel across the ground, scaled) and apex (highest root over the
  launch's), which is what the player fits a jump by. Apex rather than net rise: every take lands on the level it left,
  and what differs between a short and a high jump is how high the body goes.
- Take frames carry a clearance that keeps the soft lift from raising the pose by the capture's foot height in the
  air: in flight it is the height the soles already have in the assembled pose (no lift), and it blends from the
  captured clearance over 3 frames either side of the flight. Without it the capture's 0.4 m of foot lift is added
  to the arc's own height. On the ground the captured clearance stays, so the soft lift lowers the pose to put the
  soles on the floor, which is what drops the pelvis in the crouch and the landing.

### `player.ts`

- A light physical body (velocity and heading with gains, air drag from the wind, shoves) follows the commands, and
  the animation follows the body: motion matching picks the clip frame whose path ahead, velocity and feet best fit
  what the body is about to do.
- The legs can always out-push the wind (drag is capped at 80% of their acceleration). A body told to stand has its
  feet planted: the wind leans it but does not slide it, and it settles three times harder. A standing body that gave
  way to the drag slid downwind for as long as it stood, out of the world on a long stand in a strong wind.
- Matching runs every 5 frames and whenever a clip runs out. A jump to within 3 frames of the playing frame is not
  taken, and the playing frame's cost is lowered by 0.15, so playback does not jump for nothing.
- Switches use dead blending: the old motion carries on from its last frame at its own velocity, slowing to a stop over
  0.2 s, and fades into the new clip, so neither pose nor velocity jumps.
- Playback speed stretches between 0.8 and 1.25 to follow the body's speed. The animated root moves by the clip's
  own root motion and closes 12% of its gap to the body each frame, in position and heading.
- Each foot's sole ends (heel and toe tip) are held where they touch the ground: the clip says when a foot is down,
  the height (within 2.5 cm) says which ends touch. An end is held where it was last frame only if it was on the ground
  there too; otherwise where it is now, so a foot stepping past an edge is never held over the drop. While both ends
  are held the foot's rotation is frozen.
- A held foot is pressed down until its lowest held end touches the ground (before the ends are kept from sliding):
  captured contacts sit up to 2.5 cm above the floor, more than a CSS pixel on a page.
- A held foot further than 15% of its leg's reach from its animation is pulled off and steps across, rising by 15% of
  the reach; a released foot rejoins its animation over 0.25 s. While no other foot is held the limit is 35%: pulling
  the only foot down while the other swings left both in the air for a few frames every stride whenever the commanded
  speed did not match the clip. A step clears both the ground it left and the ground it
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
- The pelvis follows the lower foot's ground with a 0.12 s time constant, but not more than 0.2 m below the ground
  under the body: a foot over a drop (the end of a shelf on a page) must not pull the body down off its surface.
- A foot whose ground is more than 0.5 m below the base (a foot stepping past an edge onto the lower ground) is over
  a drop: the body does not follow its reference, a held foot there lets go, and a foot in the air there does not ask
  the body to lower. Otherwise the body was posed on the lower ground for the one frame before the fall registered,
  and fell from there instead of from the edge.
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
- When the ground under the body is more than 0.5 m below its base, and under every sole end too, the body falls:
  every foot lets go, the base drops under gravity (9.81 m/s²) with every foot's reference at the base, and it lands
  on the ground it meets, where the feet take hold again. Waiting for the soles keeps a trailing foot still on a ledge
  from being dragged through its corner. The legs keep their grip on the air: commands still change the body's
  speed while it falls (without that, a body leaving an edge at walking speed overshot the surfaces below the page's
  drops). Smaller drops are stepped down. `height` (the base) and `falling` are exposed for
  the page, whose ground depends on how high the body stands, and a player can start at a given height (`height` in
  its start), above the ground, to fall in.
- The ground function may take the height a point is seen from (`ground(x, z, from)`). Two lookups use it: whether
  the soles are over the drop before a fall starts, and a swinging foot's reference, which also takes the ground under
  where its soles are now, seen from there; so a trailing foot still over a ledge keeps the ledge after the body has
  dropped below it. Every other lookup is from the body. Ground that ignores the third argument (terrain) is
  unaffected.
- Landings: when a fall reaches the ground, the body dips and comes back up. The dip's depth is 24% of the
  shorter leg times `1 - exp(-v / 8 m/s)` for landing speed v, so it grows with the drop but levels off before the
  knees reach their fold (a linear depth folded the rogue's and dwarf's knees fully at 2 m, and their flexion could
  no longer grow with the drop). Its shape is `x e^(1-x)` over a rise of 0.07 s plus 0.008 s per m/s, peaking at the
  rise and gone by six of them, applied under the settled height so the held legs' bounds still hold, and the knees
  of the feet the clip holds take it. The feet keep the clip's contact through it: holding every foot for the dip
  made a character walking on from a walk-off landing slide its planted feet by 1.3 to 2.8 px a frame.
  `LANDING_RECOVERY_SECONDS` (1 s) is the time after which a landing is taken as recovered, for the game panel.
- While falling no foot takes contact from the clip: a foot held on the frame a fall starts stayed planted in mid air.
  The feet reach down instead, easing over 0.15 s to 93% of the leg's reach under each hip, and each foot's last
  placement follows, so the landing starts from where the feet are drawn.
- Jumps (`jump(target)`, with `jumping()`): the target is a landing x and a surface height. The arc is
  `arcOver(rise, run, clearance)` in `jump.ts`: the apex is `clearance` (10 cm; `options.jump.clearance` overrides it)
  of base height above the target's top (a body's base is its
  feet's rest level), the launch speed `sqrt(2 g (rise + 10 cm))`, the flight time the way up plus the way down from
  the apex to the top, and the horizontal speed the run over that time. A jump is refused (`false`, nothing
  changes) when the rise is over one leg length (or `options.jump.height`), when the horizontal speed is over
  3.5 m/s, when the ground has no
  surface at the target's height under the landing x, or when the arc, sampled each step, has the base more than 5 cm
  under the target's top while over that surface (the body would go through its edge). It is also refused while
  jumping or falling.
- A jump first crouches: the landing dip, with the launch speed standing for the landing speed (so a higher jump
  crouches deeper), peaking at 0.18 s, where the body launches; it stops dead at the crouch's start so the arc is
  computed from where it crouches. The flight sets the base from the exact parabola (stepping gravity added up
  fell 6 cm short of the apex and landed 12 cm early), the body moves at the arc's constant horizontal speed, and the
  root follows the body so the landing's ground is the arc's. No foot is held in the air, and the feet follow the
  clip going up and reach down, as for falls, only after the apex (`fallSpeed` is negative going up). The landing is
  the ordinary one (dip from the downward speed), with the body's horizontal speed removed at touchdown.
- The pelvis keeps the settled drop the grounded legs had at launch, and eases it out over 0.2 s (smoothstep): the
  flight alone drops it, which moved the knight's pelvis 0.22 m in one frame at launch. No frame moves the pelvis by
  more than the launch speed over a frame (3.3 m/s, 14 cm at 24 fps; 1.25 times that with a take, whose push-off at
  the faster crouch rises that quickly), which a test holds. In flight the feet see the target's top (the ground from
  the target's height), so a sole over the target is lifted onto it instead of going into its face or edge, and feet
  reaching down for the landing are lifted above the ground under them.

- With jump takes in the database a jump is played from a take instead of the procedural dip (a database without
  takes uses the procedural dip). `jump(target)` picks the take whose flight best fits the jump: the squared
  difference of run (the distance to the target's x) and of apex (the arc's apex over the body's base, rise plus
  clearance) from the take's, each over the shortest leg. The take plays from its start (3 frames before the crouch's final
  descent), the crouch (start to lift-off) warped onto at most 0.4 s, faster than capture speed when it is longer (the
  captures' 0.6 to 0.9 s wind-up is far longer than the anticipation of a game's jump), and the landing at its own
  speed; both are scaled by the style's `rate` like walking. The body stands still (the wanted velocity is zero)
  through the crouch and the landing. The crouch phase ends the take's own way,
  at the first frame in the air, and that is when the arc launches (a launch the arc then refuses hands back to
  matching). A shove during the crouch cancels the jump and hands back to matching: it would build a gap between the
  root and the body that snaps shut at launch, or play a whole crouch before a refused arc. A shove in flight changes
  the arc's speed.
- In flight the take's frame follows the arc's clock: the time since launch over the arc's duration picks the point
  between the take's first airborne frame and its landing frame, so a super jump's long flight plays the take slowly,
  and a take's flight that is longer or shorter than the arc stays in step with the body's height. The feet keep the
  take's own legs instead of reaching down (as in a fall), lifted over the target's top and kept within the legs'
  range by the ground and reach code that already served the fall; the jump gates hold with them.
- At touchdown the landing plays from the take's landing frame at its own speed, with no procedural dip (the take's
  bent legs, soles on the floor, are the dip), until the root is back near standing; then the player resets to a
  standing frame and matches again, blending from the take's last pose. The animated root follows the body through the
  take (12% of the gap a frame) rather than by the clip's root motion. The pelvis's height comes from the take through
  the clip's clearance and the usual leg bounds, not from a separate drop: the soles are held on the floor by the same
  contact rules as walking, which a separate pelvis drop with the pelvis left at its rest height could not give (the
  feet were 12 cm up and not held).
- A jump takes about 1.1 s from command to the end of its landing (the crouch at most 0.4 s, against the dip's
  0.18 s), so a character plans fewer jumps in a given time than with the dip.
- Known limits: a fall that starts during a take's crouch, or a flight that overruns `arc.seconds`, loses the
  procedural reach-down and dip; the landing is the take's small-jump landing whatever the height, so a super jump
  lands as softly as a hop.

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

- The world config holds everything that is tuning rather than mechanism; `site/world.json` names the cast the site
  bundles for the page world (its terrain and weather settings are used by the tests).
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
- `rotateNearest` is the plain nearest-sampled rotation, the baseline the jaggies test compares RotSprite with.
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
  degrees and rotates with RotSprite. When the caller keeps each part's last step between frames (`angles`), a bone
  must turn a quarter step past the middle of two steps (`HYSTERESIS`) before it moves on, in either mode, so a bone
  near the middle does not flicker. The skin command keeps angles only with `clean`, so its sheets stay as they were.
- Callers that draw frame after frame may also keep each part's fitted length (`lengths`: kept until the bone's screen
  length moves a whole pixel) and each joint's anchor pixel (`anchors`: kept until the joint is a quarter pixel outside
  it), so a joint or bone near a pixel boundary does not dither between two pixels. Anchors are kept per joint, so
  parts that share a joint stay together. The page world keeps all three per character.
- A part given a curve (`curves`, keyed by its second joint) is drawn along it instead of rotated: each pixel near the
  curve takes the sprite's column at its distance along the curve and the row at its distance across, and the sprite
  is fitted to the curve's length.
- Eight-direction skins take the character's yaw and keep the chosen view's sector between frames, so the view
  changes with hysteresis. A part shows the chosen view's sprite, or its counterpart's mirrored in a left-facing
  direction, fitted to the bone's on-screen length; one-view skins show their own sprite.
- A mirrored two-joint part turns its unmirrored sprite by the mirrored angle and flips the result, so left- and
  right-facing directions are exact mirrors of each other.
- Clean rotations are cached by sprite, pivot and step; at most 4096 are kept, oldest dropped first.
- Eight-direction skins also get inner lines and darker far limbs; one-view skins render without them.
  - Of each left and right pair, the one more than 5 cm deeper (`FAR_DEPTH`) than its counterpart is drawn a shade
    darker.
  - Inner lines are drawn as a pixel artist draws them where one part overlaps another: wherever a part's pixel borders
    an earlier (farther) part it does not share a joint with, that farther pixel takes its next shade down. Parts that
    share a joint join without a line.
  - A colour's next shade down is the darker palette colour nearest in hue and saturation (the colour less its grey),
    with the step closest in brightness breaking ties; a colour with nothing darker keeps itself.

### strip.ts and order.ts (the page's painter)

- The page draws every two-joint part with one painter, `paintStrip`: the sprite laid along a polyline of pixel
  points, a rigid part's stepped bone or a cloth-bound part's curve. Every joint and curve point of a character is
  projected and snapped to a pixel once per frame (with the anchors' quarter-pixel hysteresis), and every part
  starts at its snapped first joint, so parts sharing a joint start at the same pixel. The skin command keeps the
  rotating painters, so its sheets stay as they are; the cast's `painter: 'rotate'` draws the page with them, for
  comparison.
- A rigid part's strip starts at its snapped first joint and turns in 22.5-degree steps, with the rotating painter's
  hysteresis, rather than running to its snapped second joint: laid at any angle, a thin part a few degrees off
  vertical (a hat cone) came out ragged under nearest sampling, and the judges preferred the stepped one. Its end can
  so land up to about 2 px from the next part's joint on a 10 px bone; the survey counts frames where an end is 2 px
  or more off a joint another two-joint part starts or ends at (free ends, a sword tip or a hat tip, are not
  counted), reported only when the caller asks for footprints, so the page does not pay for it.
- The middle is laid over the bone's projected length, kept between frames until it moves a whole pixel, along the
  polyline from the first point: two snapped ends would otherwise make a 4 px foot 4 to 5.4 px from frame to frame as
  its diagonal crosses pixels. It is held between 0.6 (rounded) and 1.25 of the sprite's drawn length, stopping short
  of the last point or running on past it, so a sprite is never squashed or stretched beyond those bounds and the
  part's end misses its joint instead (the survey reports how often by 2 px or more). Caps (the columns before
  pivot A and after pivot B) keep their size along the first and last segments. Rows lie along each segment's
  normal, the bisector at inner points, so neighbouring segments share an edge: a bend cannot tear, and where
  segments overlap inside a fold the later one wins, so a fold is solid. Pixels are mapped back to the sprite and
  sampled nearest. When a part's ends snap to the same pixel (a foot pointing at the camera) it is laid along its
  projected direction, not an arbitrary one.
- Draw order (`drawOrder`): layer first, then farther before nearer, but two parts keep last frame's order unless
  their depths differ by more than 3 cm, so parts at nearly the same depth do not swap back and forth. Level parts
  keep the mannequin's order, the later drawn above: authoring order is the structure (helmet after head, face after
  hood). New parts are placed by the same rules. The rule is transitive (an interval order), so one insertion pass,
  each part moved before the earliest it must precede, satisfies every required pair; moving a part ahead can carry
  it past level parts between, so about one in two hundred level pairs swaps on such a frame.

### fit.ts (`npm run skin -- fit`)

- Checks that each view's sprite span suits the bone it is drawn on. The rest pose is turned to each view's centre
  facing (both the plain and the mirrored sector, since a mirrored sector draws the counterpart's sprite on this
  part's bone) and to 20 degrees either side within the sector, then every two-joint part's bone is projected by the
  page's camera (`pageCamera`, at the page's pixels per metre over its sprite scale). A part is flagged when the
  projected length falls more than a pixel outside the painter's bounds for the span (`lengthBounds` in `strip.ts`,
  the same function the painter clamps with), since the part is then drawn true to the sprite and misses its joint.
- Rest is the check's pose: walking changes bone lengths, so a flag is a sprite that is wrong at rest and a pass is
  not a guarantee. It is a separate subcommand, not part of `preview` or `check`, so their outputs stay as they are
  (`check` reads no skin).
- Flagged sprites are fixed in the art, not in the painter: the sprite is redrawn so its pivot span suits the bone
  from the page camera (a foreshortened sword, plume or foot drawn short, a three-quarter mantle or scarf narrower
  than the front one), with its end pieces kept at their size unless they are foreshortened with it (the back view's
  sword grip). A mirrored sector draws the counterpart's sprite, so one sprite serves two bones; where their ranges
  need different spans, no span fits both.

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
- Cape anchors and chain anchors sit just outside the body parts their cloth collides with (a pinned particle inside
  a part counts as cloth inside the body). Parts that would push a hanging panel from the wrong side are left out
  of its collisions: the dwarf's axe, the wizard's forearms and hands. The wizard's robe sways through a back panel
  hung from the hips; a closed skirt round the legs would let walking legs push through its front between the
  particles at any practical spacing, failing the cloth gates. The panel's anchors sit outside the robe and it
  collides with the robe: ignoring the robe let a panel flung over the head in a fall come down through the body and
  stay in front.

### solver.ts

- `step` advances one substep; `t` is the time at its end, where the pinned particles move to the root pose and the
  wind is sampled. The caller loops substeps.
- With `pose`, the collider and pins use that body-local pose instead of the rest mannequin; it must return the same
  object for every `t` within a frame so the collider is compiled once per frame. With `transforms`, a pin's offset
  also turns with its joint's rotation.
- Each constraint is solved once per substep, so its XPBD multiplier starts at zero and never needs storing.
- `collisionPasses` repeats the collision pass in a substep; `settle` runs collision passes alone with the end of the
  frame's body. A particle between two parts (between the legs) can be pushed out of one into the other; more passes
  let it find room.

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
- The live renderer is run from the first Piñata checkout: a folder whose `package.json` is named `pinata` and that
  holds `src/cli/live.ts`. The candidates are the repository two folders up when the mod is loaded from the repo's
  `mods/pinata` (also how a folder marketplace is read), then the marketplace checkout when it runs from the plugin
  cache, which holds only the mod (`<plugins>/cache/<marketplace>/<plugin>/<version>` beside
  `<plugins>/marketplaces/<marketplace>`). The session's project is never a candidate: any cloned repo could name
  itself `pinata` and have its code run. The checkout follows the marketplace and can be ahead of the cached mod.
- The checkout is looked up at session start, without holding it up, and on each retry, not in the pane's timer, so
  lookups never overlap. Until one is found no child starts. With none, the pane stops and says so; `/pinata open`
  (or `/pinata` on a closed pane) retries and redraws the pane, and `/pinata` on a shown pane still closes it.

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
