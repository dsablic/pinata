# Game Sprite Style

Every game-like round has named the same gap between the page's characters and hand-drawn game sprites, whatever the
motion: next to the references the cut-outs read as flat and tall. The references have a large round head (about two
fifths of the figure), strong light-to-dark shading on every part with bright highlights on metal and skin, and parts
that differ clearly in value from their neighbours. The knight has a small helmet on a tall body, and its armour is
mostly two mid tones, so torso, arms and legs blur into one shape. Drawn walk frames
([plan](2026-11-03-drawn-walk-frames.md)) did not close the gap, and the judges named the style beside the motion. This
plan changes the art style of the skins, not the motion: all motion keeps using the cut-outs. It starts with one
character, is judged, and falls back to settling the visual bar where it is if it misses.

## Design

- **Bigger heads.** The head (helmet, hood, hat) is a one-joint part drawn at its sprite's size, so it can grow
  without touching the rig or the motion: about two fifths of the figure's height as drawn, as the references'.
- **Shading with a light.** One light from the upper front; every part shaded from it with at least three tones: a lit
  edge, a body tone and a shadow side, and bright highlights on metal. Neighbouring parts differ in value (a lit
  pauldron over a darker upper arm, a lighter thigh than shin), so the figure reads as parts.
- **Same palette keys, same rig.** Sprites keep their pivots and the parts they are bound to; the palette may gain
  colours. Nothing in the renderer changes.
- **The knight first,** its side views (side and the three-quarter views, as the strips show them), then its front and
  back so its views match, then the rogue, dwarf and wizard.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical, except outputs that draw a restyled skin | no code changes |
| Fit | `npm run skin -- fit` flags no more parts than before for the restyled character | |
| Survey | the restyled character's pops, fragments and stretch no worse than now | `npm run glitches` |
| Style earns its place | the restyled knight's walk and landing strips against the current knight's same strips, three judges on three models, both orders, controls: the restyled picked as better game art in at least 2/3 of non-control answers and rated higher on average | decides whether the style stays |
| Knight alone | the drawn-walk plan's knight-alone round (against the four clothed references): rated at least the references' mean, picked as software in at most 60% of non-control answers, rated at least 3.5 by the largest-model judge | decides whether the other three are restyled |

## Batches

- **A. The knight:** its side views restyled, the fit and survey gates, both rounds. If the first round misses, the
  style is not kept; if the knight-alone round misses, the knight keeps the style (it earned its place), its front and
  back are restyled to match, and the visual bar is settled where it is: no further style or frame work, effort moves
  to other parts of the roadmap. Review.
- **B. The rest,** only if the knight-alone round is met: the knight's front and back, then the rogue, dwarf and
  wizard; the all-four game-like round; release. Review.

## Results

### Batch A: the knight

Drawn: a bigger great helm (17 x 17 px, from 14 x 14, growing forward, back and down over the shoulders so the plume
keeps its place), every steel part shaded from one light at the upper front (shadowed back edge, body tone, lit band
with a white highlight), a wider breastplate, thighs and pauldrons, a cape with fewer, softer folds; side and both
three-quarter views. The fit check flags the same single part as before (the back three-quarter foot).

- Style earns its place: the restyled knight's walk and landing strips against the current knight's, three judges on
  three models, both orders: the restyled picked in 6 of 12 non-control answers, 50% (gate at least 2/3), rated 2.83
  against 2.50 (gate higher: met). **Missed.** The landing went to the restyle 5 to 0 (1 can't tell, rated 3.3
  against 2.5); the walk did not separate (1 to 2, 3 can't tell, 2.3 against 2.5). Controls unseparated by 33% of
  judges; left picks 43%.
- What the judges named: the restyle's cape draping and flowing on the landing; on the walk, the same crouched start
  and legs that barely move in both, the sword fixed in place. Two of three said the halves looked nearly identical at
  the size shown.
- The packet put the two 8-frame strips 2 px apart, and one judge read each item as a single 16-frame strip; the
  judging tool's side-by-side layout does not separate long strips clearly.
- By the plan's rule the style is not kept: the knight's skin is as before (the restyled one is in
  `pocs/game-sprite-style/`) and the knight-alone round was not run. The visual bar is settled where it is.
