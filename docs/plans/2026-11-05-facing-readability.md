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
