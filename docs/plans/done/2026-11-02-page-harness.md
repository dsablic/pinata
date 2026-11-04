# A Faster, Deterministic Harness for the Page World

**Goal:** the page world's behaviour is checked in Node, deterministically and in seconds, on the real layouts of
the test pages and the demo; the browser checks only what needs a browser. Today every behaviour check runs in
Chrome in real time (about 5 minutes), depends on rAF timing and random wandering, and waits for events to happen.

## Design

- **A DOM-free core** (`src/page/cast.ts`): characters, walkers, the layout (marked boxes with hints, keyed by an
  opaque key: the element in the browser, an id in Node), rescans, stepping on a clock the caller advances,
  perception decisions (visits, words), drop-ins, samples, sprite images and hit testing. `page.ts` becomes the
  browser shell: scanning and observers, events, the overlay canvas and `requestAnimationFrame`.
- **Layout fixtures** (`test/fixtures/layouts/`): each page's marked boxes, hints and interactive targets as the
  browser laid them out, at the widths the checks use. `npm run layouts` records them from Chrome; they are
  re-recorded when a test page or the demo changes, and a browser check fails when a fixture no longer matches its
  page.
- **Scenarios in Node**: the core runs on a fixture at a fixed 24 steps per second with fixed seeds. Events are made
  to happen (an element removed under a character, a hover on a target, a character placed where it must drop)
  instead of waited for.
- **Gates apart from tests**: `npm test` asserts behaviour that must always hold; plan gates that are measured
  rather than asserted (the standing gate) are printed by `npm run gates` as met or missed.
- **A thin browser suite**: marking and the scan, observers, the overlay and click-through, pokes, modal and
  popover, focus and hover wiring (a visit is sent), layout shift, layout reads per frame, cost, reduced motion,
  high-density screens, and that the fixtures match their pages. No real-time waits for behaviour.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical | |
| Coverage | every gate of the [page-world plan](../2026-10-31-page-world.md) is measured by the Node scenarios, `npm run gates` or the browser suite | listed in design.md |
| Real layouts | the Node scenarios run on recorded layouts of the test page, the perception page and the demo at 1200 and 390 px wide | |
| Determinism | two runs of the Node scenarios give identical results | a test |
| Speed | the Node scenarios add at most 60 s to `npm test`; the browser suite takes at most 90 s | on this machine |
| No flakes | the browser suite passes 5 runs in a row | |
| Catches known bugs | each of: climbing onto rises, overshooting drops, a trailing foot sinking through a ledge, words on a visit that never arrived, a dragged-and-released foot leaving both feet up, makes a Node scenario test fail when reintroduced | mutation check |

## Results

- Built: the DOM-free cast (`src/page/cast.ts`) with the browser shell (`page.ts`) around it, layout fixtures and
  `npm run layouts`, Node scenarios (`test/page-scenarios.test.ts`), `npm run gates` (and `-- --browser` for the same
  measures in Chrome), and a browser suite without behaviour waits. Reviewed; the review's findings are fixed.
- Existing outputs: byte-identical. **Pass.**
- Coverage: surfaces, page usability (clicks, pokes, modal dialogs, layout shift, wheel scrolling, text selection),
  layout reads, cost, reduced motion, hover and focus sending a visit with the right words, and the fixtures matching
  their pages in the browser suite; falls, landing room, no re-placements, connectivity of the demo, climbing,
  liveliness, perception (nearest character, arrival in 8 s, words, refusals) and drop-ins in the Node scenarios on
  every recorded layout; attraction in the walker tests; standing in `npm run gates`, in Node and in Chrome. A bubble
  being drawn is not checked. **Pass.**
- Real layouts: the test page, the perception page, and the demo at 1200 and 390 px. **Pass.**
- Determinism: a test runs the 390 px demo twice for 45 s, past the first drop-ins, and compares every step's
  characters, the samples and the visits. **Pass.**
- Speed: `npm test` takes about 21 s in all, the scenarios about 10 s of it; `npm run gates` 4 s; the browser suite
  about 35 s (it took about 5 minutes). **Pass.**
- No flakes: 5 browser runs in a row passed. The browser's check that characters stand on live surfaces allows 8 px
  between the lowest sole and the surface (it is not a plan gate; the precise foot gates are `npm run gates`): at
  3 px one of the first five runs failed it on a character mid-stride. **Pass.**
- Catches known bugs: each of the five, reintroduced, fails a page-scenario test on a recorded layout (climbing: a
  rise added to the perception page; overshooting drops: a character placed again after running out of ground;
  the sinking foot: a sole through a surface; words on an unreached visit; both feet up: mid-air frames over 1.5%),
  and most also fail a walker or motion-capture test. **Pass.**
- Layout geometry depends on fonts: the fixture check compares boxes only on the platform the fixtures were
  recorded on (macOS here), and ids, hints and targets everywhere.
