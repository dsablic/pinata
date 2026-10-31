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
