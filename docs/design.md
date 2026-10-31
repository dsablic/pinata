# Design notes

Implementation choices and the reasons for them. Code carries no comments: names and structure say what it does,
this document says why. Plans and their gates live in [`plans/`](plans); this file describes how things are built
as they stand now.

## Conventions

- No comments in code. Names say what a value or function is (`MARGIN_FROM_SURFACE_ENDS`, `surfaceBelow`); when a
  choice needs a reason, the reason goes here under the module's heading.
- Older modules still carry doc comments; they move here when those modules are next changed.

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
- `--pinata` is an inherited custom property, so a stylesheet rule marks an element's children too. An element only
  counts when its value differs from its parent's: marking a card marks the card, not its paragraphs.
- Boxes narrower than 4 CSS px (`NARROWEST_GROUND_PX`) never become ground: nothing can stand on them.
- The scan walks the whole body and reads every element's computed style once per scan. Scans run on load and on
  change only, never per frame.
- Change detection: a ResizeObserver on the body, a MutationObserver for added and removed nodes and for changes to
  `data-pinata`, `class`, `style` and `hidden`, window resize, and the fonts becoming ready. Callbacks are coalesced to
  at most one rescan per animation frame. Not detected: elements moved by CSS animations or transitions without a
  resize; pages that need that can mark fewer, stabler elements.

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
  added or removed. After a rescan each character stays at the same share of its element's width; if its element is
  gone it is placed on another.
- Only cast members with a skin live on the page: the procedural renderer is too heavy to run per character on
  arbitrary pages.
- Starting places are drawn with a seeded random generator, weighted by surface width, at least 0.3 m from a
  surface's ends (`MARGIN_FROM_SURFACE_ENDS`).
- Each character renders into its own sprite box, 1.6 times its height square (`SPRITE_BOX_IN_CHARACTER_HEIGHTS`),
  with its feet line at 85% of the box (`FEET_LINE_SHARE_OF_BOX`), through a camera 8 degrees above the horizon
  (`CAMERA_ELEVATION_DEGREES`): nearly side-on, so characters read against a flat page.
- The overlay is one canvas fixed over the viewport with `pointer-events: none` and the highest z-index, marked
  `aria-hidden`. It is redrawn on scroll, on rescans and after a poke; characters outside the viewport are skipped.
- Clicks are caught on the document in the capture phase. A click whose point falls on an opaque pixel of a drawn
  character pokes it and is stopped (default prevented, propagation stopped); every other click is left untouched, so
  the page behaves as if the overlay were not there.
- With `prefers-reduced-motion: reduce` a poke does not turn the character.
- `window.__pinata`-style state (`ground`, `characters`, `pokes`, `rebuilds`) is returned for tests and tools; the
  page decides whether to expose it.
