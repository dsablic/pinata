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
  falling to the far side; side views show a profile with the nose, the toes pointing forward. Claude draws them.
- **Engine cues, only where the skins cannot carry them,** for example the body's yaw in a three-quarter view or the
  order of near and far parts. Each is a meant output change, accepted and named.
- **Authoring.** The guide's skin section gets the direction cues as a short checklist, and `pinata check` or
  `skin preview` shows the eight idle frames side by side so an author sees what a judge sees.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Every direction | the Phase 1 gate: a blind panel of the eight idle frames per example character names each direction correctly in at least 90% of answers | three judges, every frame to every judge, the judge runner |
| No direction left behind | each of the eight directions at least 2 of 3 answers right on every character | |
| Walks read too | the same panel on a mid-stride walk frame at least 80% | a walk frame carries motion cues and occlusion |
| Calibration control | reported, not gated: the LPC frames' score in the same form | tells whether 90% is within reach of art made by people |
| Existing outputs | byte-identical except the redrawn views and any named engine cue | `npm run verify`, changes accepted and named |
| Every other gate | the four examples still pass every export gate and `npm run verify` | |

## Batches

- **A. Diagnosis:** the larger panel through the judge runner, the confusion matrix, the LPC control. Review.
- **B. Redraw:** the back and three-quarter views of the four examples first, then the side views where the matrix
  says so; the panel after each character; engine cues only if the matrix shows a cue the skins cannot carry.
  Review.
- **C. Authoring:** the checklist in the guide, the eight-frame preview, a fresh agent's skin through the panel.
  Review.
