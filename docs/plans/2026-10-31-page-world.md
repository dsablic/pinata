# The Page as the World

**Goal:** characters live on an ordinary web page. Elements the page marks become ground (their top edges) and walls
(their sides); characters walk on them, drop from one to the one below, step up small rises, react to the page
(walk to a hovered button, sit on a heading, flee a click), and never get in the way of the page. Then the world demo
is rebuilt on its own page's elements instead of the generated terrain.

The world demo moves onto this: it is rebuilt on its own page's elements instead of the generated terrain. This is
batch E of the [world showcase](2026-10-30-world-showcase.md).

## Design

- **Marking.** An element is ground when it has `data-pinata="ground"` or the CSS custom property
  `--pinata: ground` (read with getComputedStyle, so a stylesheet can mark many elements at once); `wall` makes its
  sides block walking; `none` excludes it and its children. Hints ride along the same way: `data-pinata-say` (what a
  character says beside it), `--pinata-attract` (how much characters like to go there).
- **Surfaces.** Each ground element's top edge, in page coordinates, becomes a flat surface (x from its left to its
  right, at its top), converted to metres by the world's pixels per metre, with up flipped. Surfaces are rebuilt only
  when something changes: ResizeObserver on the marked elements, a MutationObserver for elements added, removed or
  re-marked, and font loading; never per frame. Scrolling does not change page coordinates.
- **The graph.** Surfaces are nodes; edges join them where a character can get from one to another: walking across
  where two surfaces meet at the same height (within a step), stepping up a rise of at most the step height, dropping
  off an edge onto the highest surface below it within a drop limit, and (later) jumping. Paths come from a shortest
  path over the graph.
- **Characters on surfaces.** The world's ground function becomes per character: the height of the surface it is on
  (and, near an edge, the surface it is stepping or dropping to). Motion-captured characters fall under gravity when
  they walk off an edge (their physical body already has vertical speed) and land with a landing reaction; planned
  characters stay on their surface and turn at its ends until they can drop.
- **Overlay.** One canvas fixed over the viewport, `pointer-events: none`, drawn at the page's scroll offset, with
  only characters in or near the viewport drawn. Clicks are caught on the document in the capture phase: a click on a
  character pokes it and stops there; any other click reaches the page untouched. Respects
  `prefers-reduced-motion` (characters stand still, no falls).
- **Perception.** Behaviours can ask what is near: marked elements within reach, the hovered element, the focused
  one, with their hints; activities gain targets like `{ to: 'hovered' }` and `{ to: 'attract' }`.
- **Tests in a real browser.** No new packages: a small harness drives the locally installed Chrome over the
  DevTools protocol (Node's own WebSocket), loads test pages with known layouts, and reads state from the page; it
  runs in CI on the runner's Chrome.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical | the generated-terrain world keeps working |
| Surfaces | every marked element's top edge becomes a surface within 1 CSS px, after load, after a resize, after scrolling, and after an element is added, moved or removed | test pages with known layouts |
| Standing on the page | in the browser, every planted foot's sole within 1 CSS px of its surface; no frame where a character stands in mid-air (both feet more than 3 px above every surface under them) except while falling | measured from the page |
| Falls | a character that walks off an edge lands on the highest surface below it, never passes through a surface, and its feet are on that surface within 3 frames of touching it | |
| The page stays usable | clicks on any page element's centre reach it unless a character is under the pointer; scrolling, text selection and keyboard focus are unaffected; the overlay causes no layout shift (CLS 0) | in Chrome |
| Cost | with 4 characters, the world's main-thread time per frame at most 8 ms at p95, and no layout reads per frame (rects only on change events) | pages must stay responsive |
| Liveliness | over 60 s each character starts at least 4 activities and stands on at least 2 different elements | uses the page |
| Reduced motion | with `prefers-reduced-motion: reduce`, nothing moves | |
| The demo | the world demo page is rebuilt on its own elements, passes every gate above, and replaces the generated-terrain page | user direction |

## Batches

- **A. Surfaces and the overlay:** marking, surfaces from the DOM with observers, the overlay canvas with scroll and
  culling, click handling; characters standing still on surfaces; the browser harness; the surface, page-usability
  and reduced-motion gates. Review.
- **B. Moving over the page:** the surface graph, paths, per-character ground, stepping up and dropping (falling and
  landing for captured characters, turning at edges for planned ones); the standing, falls and cost gates. Review.
- **C. Perception:** what is near, hovered and focused, hints, the new activity targets; the liveliness gate.
  Review.
- **D. The demo:** the world demo rebuilt on its own page; every gate again on it; release. Review.

## Results

Measured by `npm run test:browser` on `test/pages/page-test.html` (four skinned, captured characters, 54 px per
metre, scale 2) and by the Node tests.

- **Batch A built and reviewed.** Surfaces, page usability and reduced motion pass.
- **Batch B built.** The surface graph, walkers that wander over it, falls and landings in the player, and a
  per-frame loop.
  - Surfaces, page usability: pass, as in batch A, with the characters moving.
  - Reduced motion: pass; nothing steps, and a poke turns no one.
  - Falls: pass. The test removes the element under a character with a surface below it; it falls onto that surface,
    no sole goes more than 1 px through a surface, a foot is on it within 3 frames, and no fall lasts over 4 s. In
    Node, walking off a 1.5 m ledge.
  - Cost: pass. p95 1.4-3.3 ms per frame with 4 characters; no layout reads and no rescans over 1.5 s with nothing
    changing.
  - Standing, planted feet: met in the final runs (0 of about 1100 planted feet more than 1 CSS px off, worst
    0.97 px); earlier runs had 1 foot at 1.13 px, so it holds narrowly.
  - **Missed: standing, mid-air.** 4-10 of 960 frames (0.4-1%) have every foot more than 3 px up while not falling.
    What is left comes from the turn, start and stop clips (`walk-turn-right` frames 46-55 most), where the stance
    foot is pulled into a corrective step while the other foot lifts. Before batch B's player changes, planted feet
    were off by up to 1.35 px in 3% of planted feet and 3-4% of frames were mid-air.
