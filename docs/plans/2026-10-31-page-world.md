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
| Perception | hovering an element, or focusing one from the keyboard, brings the nearest character that can reach it onto the surface under it, within 1 m of the element's centre, in at most 8 s; one arriving at an element with `data-pinata-say` shows that text beside it | batch C |
| Attraction | over 10 seeds of 60 s in Node, characters spend at least twice as much time per metre on elements with `--pinata-attract: 3` as on unmarked-attraction ones | batch C |
| Reduced motion | with `prefers-reduced-motion: reduce`, nothing moves | |
| The demo | the world demo page is rebuilt on its own elements, passes every gate above, and replaces the generated-terrain page | user direction |

## Batches

- **A. Surfaces and the overlay:** marking, surfaces from the DOM with observers, the overlay canvas with scroll and
  culling, click handling; characters standing still on surfaces; the browser harness; the surface, page-usability
  and reduced-motion gates. Review.
- **B. Moving over the page:** the surface graph, paths, per-character ground, stepping up and dropping (falling and
  landing for captured characters, turning at edges for planned ones); the standing, falls and cost gates. Review.
- **C. Perception:** hovered and focused elements, hints (words, attraction), visits to a noticed element, named
  activities; the perception, attraction and liveliness gates. Review.
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
- **Batch C built and reviewed.** Hints, hover and focus perception, visits by the nearest character that can reach
  the place, words in bubbles, attraction in goal choice and rest length, named activities. In place of activity
  targets like `{ to: 'hovered' }`, the page sends a walker on a visit; nearness beyond hover and focus is left out.
  - Perception: pass. Hovering a button's label sends the nearest character, which reaches the button's floor in
    1.8 s and says the button's words; Tab to a field inside a floor element sends the nearest, which reaches it in
    4.9 s and says the field's words.
  - Attraction: pass. Over 10 seeds of 60 s, 3.14 times as long per metre on the element with attraction 3 (1.10 with
    none).
  - Liveliness: pass. Over 60 s, 13-16 activities and 2-3 elements per character.
- **Batch D built.** The site's front page is the page world on its own cards and tiles; the generated-terrain
  page is gone (the world engine and its config stay for the tests). Characters that have stood on one element for
  30 s drop back in from above. Fixes found on the demo: drops need landing room, a body keeps its speed across the
  page while it falls, a fall waits until no sole is over ground near the body, and a placed foot looks ground up from
  its own height (a trailing foot sank through a ledge's corner as the body stepped off).
  - Review fixes: a point sees ground only 2 cm above itself, so feet do not climb rises; a falling body keeps its
    traction again (without it, drops overshot their landings); a drop-in starts where nothing is between it and its
    place; the demo's cards alternate sides across rows at phone widths, so every card leads down to the floor; the
    suites are selectable and an unknown one is an error.
  - In Chrome on the demo: cost (p95 3.8 ms), no layout reads, surfaces, standing on live surfaces, clicks, pokes,
    hover and focus sending visits with their words, and reduced motion: pass. On the demo's recorded layouts in Node
    (see the [harness plan](done/2026-11-02-page-harness.md)): the nearest character arriving within 8 s and saying the
    words, falls with no sole through a surface, liveliness, drop-ins and connectivity at 1200 and 390 px: pass.
  - **Missed: standing** (`npm run gates`). In Node over 60 s per layout, planted feet: 10-38 of about 7000 more than
    1 CSS px off, the worst 1.12-1.13 px; mid-air: 21-49 of 5759 frames (0.4-0.9%). In Chrome over 20 s per page:
    5-14 of about 2000 planted feet off, the worst 1.10-1.12 px; mid-air: 8-33 of 1920 frames (0.4-1.7%). The same
    turn, start and stop clips as before.
  - The demo gate (rebuilt on its own elements, every gate above, replacing the generated-terrain page) is met except
    for the standing gate, missed narrowly here as on the test page.

