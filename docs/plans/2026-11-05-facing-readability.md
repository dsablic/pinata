# Facing Readability

A game sprite must read its direction from one frame. The Phase 1 direction panel missed: judges named the direction
of the four examples' idle frames correctly in 44 of 96 answers (46% against 90%). Three-quarter views were named as
front or side, and the wizard's back views as front (a white patch at the head reads as a beard or face). Every frame
is drawn in its direction's view, so the misses are in what the views show, not in which view is drawn.

## Design

- **Diagnosis before drawing.** A confusion matrix per character and direction from a larger panel (each frame shown
  to every judge, three judges, both the idle and a walk frame), and a calibration control: hand-drawn game sprites
  (LPC, four directions, kept outside the repository) in the same panel form, to measure how well the judges name a
  direction on art made by people. The control is reported beside the score; it does not change the gate.
- **Direction cues in the skins.** The views are redrawn with the cues game artists use: back views show hair, hood,
  helmet back or cape and no face or beard; three-quarter views show the face shifted toward the facing side, one
  eye or the far eye smaller, the nose or visor past the head's outline, the near shoulder and arm larger, the cape
  falling to the far side; side views show a profile with the nose, the toes pointing forward. Piñata is a general
  tool, so the cues are taught and checked by the tool for any author's character, not drawn into the examples by
  hand: the batch A diagnosis on the examples shows which cues the checks must cover.
- **Engine cues, only where the skins cannot carry them,** for example the body's yaw in a three-quarter view or the
  order of near and far parts. Each is a meant output change, accepted and named.
- **Authoring.** The guide's skin section gets the direction cues as a short checklist, and `pinata check` or
  `skin preview` shows the eight idle frames side by side so an author sees what a judge sees.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Every direction | the Phase 1 gate: a blind panel of the eight idle frames per character names each direction correctly in at least 90% of answers | three judges, every frame to every judge, the judge runner; batch C judges the fresh agents' characters |
| No direction left behind | each of the eight directions at least 2 of 3 answers right on every character | |
| Walks read too | the same panel on a mid-stride walk frame at least 80% | a walk frame carries motion cues and occlusion |
| Calibration control | reported, not gated: the LPC frames' score in the same form | tells whether 90% is within reach of art made by people |
| Existing outputs | byte-identical except the redrawn views and any named engine cue | `npm run verify`, changes accepted and named |
| Every other gate | the four examples still pass every export gate and `npm run verify` | |

## Batches

- **A. Diagnosis:** the larger panel through the judge runner, the confusion matrix, the LPC control. Review.
- **B. Direction checks in the tool,** for any character, not the examples: an eight-direction sheet in `pinata skin
  preview`; structural checks in `pinata check` that need no judge (a three-quarter view's head and torso differ from
  both neighbouring cardinal views by more than a mirror or a few pixels; a back view's head carries none of the front
  view's face colours; a side view's head is not left-right symmetric), each a declared gate with failing and
  passing cases; `pinata review` (and the MCP tool), which runs the blind direction panel on the author's own
  character through the judge runner and names the misread directions with their confusions; the direction
  checklist in the guide. Review.
- **C. The tool's test:** fresh agents with only the guide and the MCP server draw the exit test's three characters,
  using the checks and `review`; their characters, not the examples, are judged against the gates above (fresh seed).
  The examples are redrawn only as far as the new checks fail them. Review.

## Results

### Batch A: diagnosis

The direction panel (`npm run direction-panel`) holds 64 items: each of the four examples' eight directions as the first
idle frame and as the walk frame whose two feet are furthest apart (`widestStride`). Three judges (opus, sonnet,
haiku) saw every item; each judge therefore saw each character in each direction twice, once idle and once walking, so
elimination between the two frames can only have raised the shares. The panel is a new round (seed `facing-2`, a
question that says "standing or walking"), so its idle share is not a repeat of the Phase 1 panel's 46%.

| Measure | Result |
|---|---|
| Idle, 96 answers | 61 right, 64% (gate 90%) |
| Walk, 96 answers | 54 right, 56% (gate 80%) |
| By judge, idle and walk together (64 answers each) | opus 48, sonnet 39, haiku 28 |
| Idle by character, of 24 | knight 18, rogue 14, dwarf 18, wizard 11 |
| Walk by character, of 24 | knight 20, rogue 8, dwarf 11, wizard 15 |
| No direction left behind (2 of 3 right, per character and direction) | missed: 21 of 32 cells pass for idle and 21 of 32 for walk |
| Cost | opus $0.414, sonnet $0.176, haiku $0.018: $0.61 for 192 answers |

Per direction (12 answers each, idle / walk): front 12 / 9, front-right 5 / 5, right 8 / 3, back-right 3 / 4, back
10 / 9, back-left 5 / 7, left 9 / 8, front-left 9 / 9. The three-quarter views are the weakest (back-right 3 of 12
idle); the cardinal views are right in 39 of 48 idle answers (81%) and 29 of 48 walk answers.

Calibration control: four differently dressed LPC characters (a peasant, a plate-armoured paladin, a bearded mage in
a pointed hat and cape, a hooded-cape thief; base-body walk sheets, standing frame, scaled like our items, the same
eight labels offered) in the four cardinal directions, 16 items, the same three judges: 41 of 48 right (85%; opus 16,
sonnet 15, haiku 10 of 16). Front 12 of 12, back 12 of 12, right 8 of 12 (named front-right 3, left 1), left 9 of 12
(named front-left 2, front-right 1). The control has no three-quarter views, so it measures the cardinal views only:
people's art reaches 100% on front and back and about 70% on the sides with eight labels offered, against our 100%
front, 83% back, 67% right and 75% left on idle frames. Our cardinal idle share (81%) is within 4 points of the
control's (85%); the gap to 90% lies in the three-quarter views, which the control does not cover. Cost $0.17.

#### Why each view is misread

Seen on the eight idle and eight walk frames of each character (the matrices below say which views).

- **Knight.** Front-right (idle 1 of 3, named front): the visor slit is centred on the helmet and the red chest
  cross is centred on the torso, so the view shows no shift toward the facing side; only the cape at the far shoulder
  and the sword hand differ from the front view. Back-right and back-left (named each other, front-left or back): the
  two views are near mirror images, a plain dome helmet (no slit in the back views, but a faint horizontal band
  across it that reads as a visor) over a cape on one side, and the only difference is the side the cape hangs and
  where the sword hilt sits. Walk: the cape swings out and keeps the view legible (20 of 24 right).
- **Rogue.** Front-right (idle named front 2 of 3, walk 3 of 3): the hood opening shows two equal yellow eyes and the
  scarf is centred, so the head is a front view with the hood opening not moved toward the facing side and the far eye
  not smaller. Right (walk named front-right 2 of 3): the hood opening holds one eye and the hand is stretched out,
  but the opening sits at the hood's front edge only a few pixels from centre. Back-right and back-left (named
  back-left, left, back): the hood dome, the red brooch patch and the belt are almost the same in both views; the
  brooch moves a few pixels, so the views differ by little (idle 2 of 3 named back-left for back-right). Back
  (named front once): the dark hood opening is not drawn but the hood's lower rim and brooch read as a scarf at the
  neck. Legs: the walk's boots are flat dark blocks without a toe direction, so they carry no facing.
- **Dwarf.** Front (walk named front-left 3 of 3): the stride shows the axe and the mantle's forward arm toward the
  left edge, which outweighs the centred beard. Right (idle 1 of 3, walk 0 of 3): a narrow profile in which the
  orange beard sits on the left half of the head, the rear side for a right-facing body, with the helmet's flat dome
  centred, so the face reads left or front-left; the mantle (the fur cloak's sprite) and the axe hang on the left too.
  Back-right and back-left (idle 1 and 2 of 3): the helmet is open at the back, and an orange beard patch shows under
  its rim in both back views, reading as a face; the wide mantle sprite is the same block in both, so only the
  mantle's fringe tells them apart.
- **Wizard.** Back-right and back-left (idle 1 of 3 each, named front, left, right): the beard sprite is a white
  block drawn at the head in the back views, with a skin-coloured sliver beside it, and it reads as a face or beard;
  the robe is a plain blue column in both views, so nothing but the hat's tip tells the two apart. Back (idle named
  front once): the same white block under the hat's brim. Front-right (idle 0 of 3, walk 0 of 3, named front or
  front-left): the face and beard are drawn centred under the hat with the beard hanging straight down, so the head
  shows no shift toward the facing side; the hat's tip leans, but the leaning is small against the head. Right (idle
  1 of 3): the beard and the face's skin patch sit on the left half of the head under a hat whose tip points up and
  right, so the face reads as left. Walk: the long robe hides the stride's legs in the side views, but the cardinal
  views read (back 3 of 3, left 3 of 3).
- **Common to all four.** The three-quarter views differ from the cardinal ones by a few pixels of head shift, so
  they read as the nearer cardinal view, the front-right as front and the back-right as back-left; the right view's
  face features (the dwarf's and the wizard's beard) sit on the rear half of the head. The control's side views were
  misread the same way (named front-right), by the large head of the LPC body, so the side-to-front confusion is
  known from art made by people too, but its front and back views read in every case.

#### Confusion matrices

Each cell counts three judges' answers; `.` is zero.

Knight, idle (rows: true direction; columns: named direction):

| true \ named | front | f-right | right | b-right | back | b-left | left | f-left | cant_tell |
|---|---|---|---|---|---|---|---|---|---|
| front | 3 | . | . | . | . | . | . | . | . |
| front-right | 1 | 1 | . | . | . | . | . | 1 | . |
| right | . | . | 3 | . | . | . | . | . | . |
| back-right | . | . | . | 2 | . | . | 1 | . | . |
| back | . | . | . | . | 3 | . | . | . | . |
| back-left | . | . | . | 1 | 1 | 1 | . | . | . |
| left | . | . | . | . | . | . | 3 | . | . |
| front-left | 1 | . | . | . | . | . | . | 2 | . |

Rogue, idle (rows: true direction; columns: named direction):

| true \ named | front | f-right | right | b-right | back | b-left | left | f-left | cant_tell |
|---|---|---|---|---|---|---|---|---|---|
| front | 3 | . | . | . | . | . | . | . | . |
| front-right | 2 | 1 | . | . | . | . | . | . | . |
| right | . | . | 3 | . | . | . | . | . | . |
| back-right | . | . | . | . | . | 2 | 1 | . | . |
| back | 1 | . | . | . | 2 | . | . | . | . |
| back-left | . | . | . | . | 2 | 1 | . | . | . |
| left | . | . | . | . | . | . | 2 | 1 | . |
| front-left | 1 | . | . | . | . | . | . | 2 | . |

Dwarf, idle (rows: true direction; columns: named direction):

| true \ named | front | f-right | right | b-right | back | b-left | left | f-left | cant_tell |
|---|---|---|---|---|---|---|---|---|---|
| front | 3 | . | . | . | . | . | . | . | . |
| front-right | . | 3 | . | . | . | . | . | . | . |
| right | 1 | . | 1 | . | . | . | . | 1 | . |
| back-right | . | . | . | 1 | 1 | 1 | . | . | . |
| back | . | . | . | . | 3 | . | . | . | . |
| back-left | . | . | . | . | . | 2 | . | 1 | . |
| left | . | . | . | . | . | . | 2 | 1 | . |
| front-left | . | . | . | . | . | . | . | 3 | . |

Wizard, idle (rows: true direction; columns: named direction):

| true \ named | front | f-right | right | b-right | back | b-left | left | f-left | cant_tell |
|---|---|---|---|---|---|---|---|---|---|
| front | 3 | . | . | . | . | . | . | . | . |
| front-right | 1 | . | . | . | . | . | . | 2 | . |
| right | . | . | 1 | . | . | . | 1 | 1 | . |
| back-right | 1 | . | . | . | . | 1 | 1 | . | . |
| back | 1 | . | . | . | 2 | . | . | . | . |
| back-left | 1 | . | 1 | . | . | 1 | . | . | . |
| left | . | . | 1 | . | . | . | 2 | . | . |
| front-left | 1 | . | . | . | . | . | . | 2 | . |

Knight, walk (rows: true direction; columns: named direction):

| true \ named | front | f-right | right | b-right | back | b-left | left | f-left | cant_tell |
|---|---|---|---|---|---|---|---|---|---|
| front | 3 | . | . | . | . | . | . | . | . |
| front-right | 1 | 2 | . | . | . | . | . | . | . |
| right | . | . | 3 | . | . | . | . | . | . |
| back-right | . | . | . | 2 | . | . | . | 1 | . |
| back | . | . | . | . | 3 | . | . | . | . |
| back-left | . | . | . | 1 | . | 2 | . | . | . |
| left | . | . | . | . | . | . | 3 | . | . |
| front-left | 1 | . | . | . | . | . | . | 2 | . |

Rogue, walk (rows: true direction; columns: named direction):

| true \ named | front | f-right | right | b-right | back | b-left | left | f-left | cant_tell |
|---|---|---|---|---|---|---|---|---|---|
| front | 3 | . | . | . | . | . | . | . | . |
| front-right | 3 | . | . | . | . | . | . | . | . |
| right | . | 2 | . | . | . | . | . | 1 | . |
| back-right | . | . | . | . | . | 2 | 1 | . | . |
| back | 1 | . | . | . | 2 | . | . | . | . |
| back-left | . | . | . | . | 1 | 1 | . | 1 | . |
| left | . | . | . | . | . | . | . | 3 | . |
| front-left | 1 | . | . | . | . | . | . | 2 | . |

Dwarf, walk (rows: true direction; columns: named direction):

| true \ named | front | f-right | right | b-right | back | b-left | left | f-left | cant_tell |
|---|---|---|---|---|---|---|---|---|---|
| front | . | . | . | . | . | . | . | 3 | . |
| front-right | . | 3 | . | . | . | . | . | . | . |
| right | . | 1 | . | . | 1 | . | . | 1 | . |
| back-right | . | 1 | . | . | . | 1 | 1 | . | . |
| back | . | . | . | . | 1 | 1 | 1 | . | . |
| back-left | . | . | . | 1 | . | 2 | . | . | . |
| left | . | . | . | . | . | . | 2 | 1 | . |
| front-left | . | . | . | . | . | . | . | 3 | . |

Wizard, walk (rows: true direction; columns: named direction):

| true \ named | front | f-right | right | b-right | back | b-left | left | f-left | cant_tell |
|---|---|---|---|---|---|---|---|---|---|
| front | 3 | . | . | . | . | . | . | . | . |
| front-right | 3 | . | . | . | . | . | . | . | . |
| right | . | 2 | . | . | . | . | . | 1 | . |
| back-right | 1 | . | . | 2 | . | . | . | . | . |
| back | . | . | . | . | 3 | . | . | . | . |
| back-left | 1 | . | . | . | . | 2 | . | . | . |
| left | . | . | . | . | . | . | 3 | . | . |
| front-left | . | 1 | . | . | . | . | . | 2 | . |

### Batch B: direction checks in the tool

Built for any character, not the examples.

- **Preview.** `pinata skin preview` (and the MCP `skin` tool) writes `idle-directions.png`: the eight idle frames as
  export draws them, labelled, enlarged 6x with nearest-neighbour.
- **Checks in `pinata check`,** each a declared authoring gate with failing and passing cases
  (`test/direction-gate-specs.ts`), each naming the view, the part and the cue to draw. Defined and reasoned in
  [`design.md`](../design.md), "Direction checks".

| Gate | Definition | Threshold and reason |
|---|---|---|
| `threeQuarterViewFindings` | head parts (parts whose joints all lie above the shoulders) and torso parts of `frontSide` against `front` and `side`, of `backSide` against `back` and `side`, each also against the neighbour mirrored; sprite pixels aligned on `pivotA`, compared in colour | at least 8 differing pixels per region (the smaller of neighbour and mirror): two 2-pixel eyes moved one column, the least change that shows a shifted face or a smaller far eye |
| `backViewFaceFindings` | colours of the front one-joint head sprites that are not on the outline ring of any head part and not in the rear half of the side one-joint head sprites; counted in the `back` and `backSide` head parts | at most 3 px: fewer than a 2 by 2 eye |
| `sideProfileFindings` | `side` head sprites against their own mirror about the centre of their opaque bounding box | at least 4 differing pixels: a nose two pixels tall present on one side and absent on the other |

- **Which examples fail which checks** (`pinata check`, a new author failure for each, so `npm run examples` reports
  them):
  - the head region is every part whose joints all lie above the shoulders, hoods, hats, scarves and plumes included.
    With it the knight's `threeQuarterViewFindings` passes, because the plume differs in every view and the sum
    over the head's parts reaches 8 while the backSide helmet is still 0 px from the back helmet; the wizard's
    `backViewFaceFindings` failed on the hat band and the rogue's on the neck scarf until face colours were taken
    from the one-joint head parts only and the outline ring of every head part was excluded (design.md);
  - wizard: `threeQuarterViewFindings` (backSide robe is 0 px from the back robe: a plain column in both);
  - rogue and dwarf pass all three. Neither back-face nor profile check fails any example: the wizard's white
    patch and the dwarf's orange patch use colours the hair or the rear half of their side heads also use, and no colour
    rule separates a beard from white hair, so those are for `review`. The front-right misreads (a visor or face
    centred, a three-quarter head 8 or more pixels from the front head) are also not caught: 8 px is what a cue needs,
    not what a judge needs, and `review` measures the latter.
- **Skin edits made for these checks.**
  - `examples/knight/skin.json`, `backSide` helmet: redrawn as a back three-quarter view, the dome shifted a pixel
    toward the facing side so its near side is wider, a dark seam off the centre line and a cheek guard edge on the
    near side; no face.
  - `examples/wizard/skin.json`, `backSide` robe: redrawn as a back three-quarter view, a dark back seam off the
    centre toward the far side and the far side darkened a step, so the near side reads wider; no beard (the head
    already had none).
  - Neither changes the rendering panel or the gates baselines (both steps report the baseline unchanged), so
    nothing was accepted.
- **Thresholds.** The thresholds (8, 3 and 4 px) were set during the build, from the size of the smallest cue and
  before any fresh character was judged. Batch C, which judges characters that fresh agents draw, is their test.
- **Not measured, never passed.** A check that cannot measure emits no gate and `check` lists it as not measured
  with the reason; a missing sprite or `pivotA` in a compared view is a finding.
- **`pinata review`** (and the MCP tool `review`): the blind direction panel on the author's character through the
  judge runner, three judges, idle frames and with `--walk` the widest-stride walk frames; prints the share right per
  frame kind against the gate, each misread direction with what it was named, and the cue. Its help and the guide say
  it costs money. Exit 0 gates met, 1 a gate missed, 3 a judge failed (no score), 2 refused; the cost is
  printed in every case. Tested with an injected `Ask` and a stubbed recorder, `--walk` included.
- **Real run:** `pinata review examples/wizard` (idle only): 9 of 24 right, 38% (front-right 0 of 3, named
  front-left 2 and front 1; right 0 of 3, named left 2; left 0 of 3; back-left 1 of 3; front-left 1 of 3; back-right
  2 of 3; back 2 of 3). Cost $0.095 (opus $0.067, sonnet $0.027, haiku $0.002), 25 s.
- **Guide.** The skin section has the direction checklist and how to use preview, check and review.
- **MCP.** Commands may be asynchronous; the server answers requests concurrently and ends after the last reply.

### Batch C: fresh agents

Setup as in the Phase 1 plan's batch F: `npm run build` and `npm pack` from HEAD (148 files), a fresh directory per
author with the tarball installed, `docs/authoring.md` copied in, `.mcp.json` with `npx pinata mcp`, the exit test's
three prompts unchanged, `claude -p` on sonnet with the judge runner's isolation, tools `Read`, `Write`, `Edit` and
the six pinata MCP tools (`new`, `check`, `skin`, `render`, `export`, `review`), the three started together, the
absolute path of `authoring.md` in the instruction, plus "Make every direction read clearly: use skin preview, check
and review. You may run review at most 3 times." One launch (a first launch with the older wording of the path was
stopped within seconds and started again clean). Directories: `scratchpad/facing-c/{smith,assassin,ranger}/`.

| Author | `check` runs | `export` runs | `review` runs (idle share) | Final `check` and `export` re-run by hand | Cost, time |
|---|---|---|---|---|---|
| smith | 6 (2nd and 3rd failed `idleFootMisses` 8, the 2nd also `threeQuarterViewFindings` 1) | 1 | 3: 71%, 71%, 63% | `check` exit 0; `export` exit 0, no `FAIL`, 16 engine notes, 0 not measured; `check` notes `backViewFaceFindings` not measured (the front face has no colour of its own) | $1.03, 8.4 min, 59 turns; reviews $0.24 |
| assassin | 5 (1st before any skin; 2nd failed `idleFootMisses` 4 and `threeQuarterViewFindings` 3) | 1 | 3: 71%, 79%, 79% | `check` exit 0 (138 s); `export` exit 0, no `FAIL`, 16 engine notes, 0 not measured | $0.84, 16.6 min, 52 turns; reviews $0.22 |
| ranger | 6 (2nd and 3rd failed `idleFootMisses` 7, the 2nd also `threeQuarterViewFindings` 3) | 1 | 3: 46%, 75%, 79% | `check` exit 0, no not-measured note; `export` exit 0, no `FAIL`, 15 engine notes, 4 not measured (loop n/a) | $1.25, 14.6 min, 71 turns; reviews $0.22 |

Every author exported with every gate passing and a cloth cape or cloak, and every author stopped with the review gate
missed (its own last review: 63%, 79% and 79% against 90%), having used all three reviews. Authors' costs $3.12,
reviews $0.68. The `export` count fell to 1 for each (batch F: 1, 2 and 4). The authors read `idle-directions.png` 3
(smith), 1 (assassin) and 5 (ranger) times.

#### Judged panel

`npm run direction-panel` gained arguments for this: `--seed`, `--out` and `<name>=<character dir>` for any
character (no arguments: the four examples, unchanged; the regenerated example panel differs from the batch A files
only in the redrawn knight and wizard back-side views). The panel is the three characters' eight idle and eight walk
frames (48 items), seed `facing-c` (the reviews use `review`), the direction question, every item shown to opus,
sonnet and haiku through `npm run judge -- run`. Cost $0.46 (opus $0.334, sonnet $0.123, haiku $0.007). By judge, of
48: opus 42, sonnet 29, haiku 19.

| Gate | Threshold | Result | Outcome |
|---|---|---|---|
| Idle share | 90% | 43 of 72, 60% (smith 10 of 24, assassin 16, ranger 17) | missed |
| Walk share | 80% | 47 of 72, 65% (smith 15 of 24, assassin 18, ranger 14) | missed |
| No direction left behind (idle, at least 2 of 3 per direction and character) | 24 of 24 cells | 15 of 24 cells (smith 3 of 8, assassin 6, ranger 6) | missed |
| Calibration control | reported | 85% on cardinal views (batch A) | not repeated |

Batch C is missed. Cells under 2 of 3 on idle frames: smith front-right 1, back-right 1, back-left 1, left 1,
front-left 0; assassin back-left 0, left 1; ranger front-right 1, front-left 1. On walk frames: smith front-right 1,
right 1, left 1; assassin right 1; ranger front-right 1, back-right 1, front-left 0. Per direction over the three
characters (of 9, idle / walk): front 7 / 8, front-right 5 / 5, right 7 / 5, back-right 5 / 6, back 7 / 7, back-left
3 / 6, left 5 / 5, front-left 4 / 5.

Confusions (rows true direction, entries are what the nine answers named; idle):

- smith: front named front-right 1; front-right named front 1 and front-left 1; right named back 1; back-right named
  back 2; back named back-right 1; back-left named back 2; left named right 1 and front-left 1; front-left named
  front-right 1, back-right 1, left 1.
- assassin: right named front-right 1; back-right, back and back-left each had one can't-tell; back-left named front
  1 and back 1 (0 right); left named right 1 and front-left 1.
- ranger: front named front-left 1; front-right named right 2; back-right named right 1; back-left named left 1;
  front-left named left 2.
- walk, the larger cells: smith right named front-right 2, left named front-right 1 and front-left 1; assassin right
  named front-right 2; ranger front-right named right 2, back-right named front-right 1 and right 1, front-left named
  left 3.

Pattern: three-quarter views named as their neighbours (front-left as left, front-right as right, back-left as
back), side views named as the three-quarter view, the cardinal views mostly right.

#### Structural checks against the judges

All three characters pass every `check` gate at the end (the final check exits 0), yet the judges misread directions
on each, so the checks do not predict readability.

- Passing checks, still misread: smith's back-right, back-left, front-right, left and front-left (the head and torso
  differ from the neighbours by at least 8 px, the check's floor, and the views are still named as the neighbours);
  assassin's back-left (0 of 3) and left; ranger's front-right and front-left (named right and left).
- The checks did act on real defects early: `threeQuarterViewFindings` failed once for each author (a back-side head
  0 px from the back view, a front-side torso 0 px and 4 px from the front view) and the authors redrew those views.
  Zero or near-zero difference is caught; a difference of 8 px is not a view a judge reads.
- `backViewFaceFindings` did not measure for smith and ranger on their first checks ("the front face has no colour of
  its own"): the beard and the hood leave no face colour to look for. No back view of any character was named front by
  more than one answer, so no back-face defect went unmeasured and misread.
- `sideProfileFindings` passed for all three; side views were right in 5 to 7 of 9 idle answers, misread as the
  neighbouring three-quarter view.
- What neither the checks nor the author could see: the ranger's first review (46%) named the front view as left,
  because the face sat behind the hood; `check` had passed it. The first reviews and the panel agree in order of
  character but not in size: smith 71% / 63% in review, 42% in the panel; assassin 79% and 67%; ranger 79% and 71%.
  The reviews' scores are a little high, since the authors drew against them.

#### Friction from the logs

- On exit 0 the MCP client shows only the structured `{"status":0,"files":[...]}`: the prose of a passing `check`
  (the "not measured" notes, "automated gates: PASS") and of a passing `review` is not in the result. A failing call
  shows its prose. The authors never saw the not-measured notes on a pass; the final summary of the smith says `check`
  passed "including the three-quarter, back-view and side-profile checks" though one was not measured.
- Every author used its 3 reviews and ended with the gate missed: the review names the misread directions and the
  cue to draw, but a result of 1 of 3 on a view gave no measure of how far the view is from readable, and the changes
  between reviews did not move the score (assassin 79% twice, smith 71%, 71%, 63%).
- The review's cue text is the same for every character; the authors repeatedly reported the cues were the ones
  they had already drawn ("the review keeps asking for a more strongly shifted face").
- `check` on the assassin took 138 s in the final re-run (ranger 39 s, smith 7 s), because of the cape's cloth
  simulation.
- The assassin's name stayed `biped-starter`; the first `check` of two authors ran on the starter body and failed
  its gates (thin parts, ground penetration, foot slide) as the guide says it may.
- One `Edit` failed on a skin row string that did not match (assassin).
- Each review costs $0.07 to $0.09 and 20 to 30 s; three per author were not enough to reach 90%.

The examples were not redrawn: `npm run verify` was not run (another batch was running), and no example failed a check
in batch B beyond the two redrawn.

### Calibration: hand-drawn eight-direction sprites

The control of batch A has four directions only. This one asks the same three judges to name eight directions on
hand-drawn eight-direction pixel art, from one standing frame: the same choice panel (`kind: "choice"`, the eight
labels and the question of `directionBase`), run through `npm run judge -- run`, reported and not gated.

- **Sources, all by hormelz on itch.io, licence read on each page.** "8 Directional 2D Businessman Character"
  (`hormelz.itch.io/8-directional-2d-businessman-character`, asset licence Creative Commons Zero v1.0 Universal;
  the `Idle.zip` download, 256 px cells, the figure 56 to 60 px tall) and "8-directional-char", a girl sample
  (`hormelz.itch.io/8-directional-char`, CC0 on its page; the `GirlSampleReadyIdle` strips, the figure 106 to 117 px
  tall). Other leads were not usable: "RPG characters 8 directions 16x16" (di3goalmeida) and the OpenGameArt "8d
  run/walk & idle" sheet (8 px) are far below the size, the di3goalmeida 64 px pack carries no licence row (personal
  and commercial use, no redistribution), OpenGameArt's Puny Characters (CC0) are 16 px chibi figures whose
  eight rows could not be told apart by eye, and OpenGameArt's "Hero character sprite sheet" (CC0, 40 by 64) draws
  front, side and back with a three-quarter walk only. The downloads sit outside the repository.
- **Panels.** Each character: its eight directions, two frames of the idle each (the first and a later one), so 16
  items and 48 answers. The frames are cropped to one common box per character and scaled so that the figure is about
  as large on screen as our items (the businessman at scale 6, the girl, twice as tall, at scale 3).
- **Directions checked by looking.** The businessman's files `dir1` to `dir8` run front-left, left, back-left, back,
  back-right, right, front-right, front: the profiles face the left and right edges, the back view shows no face,
  the front shows the tie, and the three-quarter views sit between in turn. The two back diagonals differ by a few
  pixels, so the order between them rests on the sequence. The girl's files are named for the direction she
  moves (`Down`, `DownRight`, ...); with her hair over the face and a high camera, the front and the back diagonals
  cannot be told from her frames, and the judges' answers were rotated by one step against her names (her `UpLeft`
  named back 6 of 6, `UpRight` named right 4 of 6), which fits names in screen-and-world space and not in our labels.
  Her labels are therefore not verified, and her result is reported but left out of the score.

| Measure | Businessman | Girl (labels not verified) |
|---|---|---|
| Answers right | 39 of 48, 81% (by judge: see below) | 16 of 48, 33% |
| Cost | $0.141 | $0.152 |

Businessman, share right per direction (6 answers each, two frames and three judges): front 6, right 6, back 6,
left 6, front-left 6, back-right 4 (named back-left 2), back-left 3 (named back-right 2, back 1), front-right 2
(named front-left 3, front 1). The cardinal views and the front-left read in every answer (24 of 24 and 6 of 6); the
other three diagonals read in 9 of 18. At 2 of 3 per direction, front-right and back-left fail.

What it means for the 90% gate: on the one character whose directions could be verified, drawn by a person for eight
directions, the judges name 81% of single idle frames, below 90% and failing the "no direction left behind" gate in
two directions. The misses are the same kind as in our characters (three-quarter views named as the neighbouring
three-quarter view or the near cardinal view), so the gate asks for more than the judges give on art made by a person.
The fresh agents' characters (60% idle) are 21 points below this control, not 30 below the gate; with the
four-direction LPC control (85% on cardinal views) the evidence is that about 80 to 85% is what these judges reach on
good hand-drawn art, and 90% with every direction at 2 of 3 is not shown to be within reach. One character from one
author is a thin base: the result bounds the gate, it does not set it. The gate stays as fixed.
