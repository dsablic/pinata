# Runtime Spike (P8): Live Characters in the Browser

**Question:** can a Piñata character be animated live, in a browser, reacting to events in real time (for example a
piñata in a chat window that reacts while an AI agent works), from a compact character file and a small JavaScript
runtime?

**Why now:** the proofs showed the motion engine works offline. A live runtime is the most direct product use beyond
exporting sprite sheets, and it tests two things the roadmap needs anyway: incremental (online) motion, and a renderer
fast enough for real time.

## Use case

The target use is small reactive characters in web UIs ("little computer people"): a mascot that reacts to the app
or to an AI agent's work (loading, thinking, tool calls, errors, success), can be poked or dragged, and otherwise stays
out of the way. A UI character must still look as good as game art (see P7 in the roadmap); the spike tests delivery,
reactivity and performance, not the art.

## Scope

One character (the hanging unicorn piñata from the logo), one page, tested headlessly with Playwright. Not in scope:
walking characters, skins, multiple characters, a public API commitment.

## What gets built

1. **Browser build of the engine.** An esbuild bundle of the parts of `src/` the runtime needs (formats, sim,
   raster, style), with no Node built-ins in the bundle. Node-only code (PNG encoding, file I/O, hashing via
   `node:crypto`) stays out or gets a browser-safe alternative. Report the bundle size.
2. **Compact character artifact.** A single JSON file merging a character package (mannequin, style, materials,
   motion settings). Report its size raw and gzipped.
3. **Online motion.** An incremental simulation that advances by one frame on demand, instead of planning a whole
   timeline up front:
   - the hanging body: a spherical pendulum on a taut rope with a twist spring (as in the logo prototype), with full
     3D body orientation;
   - limp legs, mane and tail as cloth chains on the moving body (existing solver, stepped per frame);
   - events applied at the next frame: `hit({ impulse, spin })`, plus behaviour changes.
4. **Behaviour API**, built on the composition model in
   [`docs/plans/2026-10-30-composable-behaviours.md`](2026-10-30-composable-behaviours.md) (phase 1 of it): the five
   behaviours below are compositions in a `behaviours.json` (base `hang`, layers, additive overlays, events,
   blending and a state machine), not hard-coded. A small runtime object:
   - `createCharacter(artifact, canvas, options)`
   - `character.hit(options?)`
   - `character.play(name)` with `idle`, `think` (slow sway), `busy` (small bounces), `celebrate` (spin and bounce),
     `fail` (a hard hit)
   - `character.stop()`
   - Transitions between behaviours blend over a short time instead of snapping.
5. **Renderer at real-time settings.** The existing procedural renderer with temporal hysteresis, at 64 px, drawing to
   a `<canvas>` with `putImageData`, in a Web Worker if the main thread would stall. Sub-sample count is configurable
   (default 4 instead of 16 per pixel); report the quality difference.
6. **Demo page** `pocs/runtime-spike/`: the canvas, buttons for each behaviour, click on the character to hit it, an
   FPS and frame-time readout. `npm run runtime` serves it locally for manual viewing.
7. **Web-character integration (minimal):** the character as a custom element
   (`<pinata-character src="unicorn.json">`) that can be attached to a page element (hanging from a header or a
   button); an event bridge mapping page events to behaviours (`loading`, `error`, `success`, `idle` and fake
   agent events such as `toolStart`); poke (click) and drag (pull the rope and let go); `prefers-reduced-motion`
   respected (behaviours reduced to gentle, slower motion); the element never blocks clicks on the page outside its own
   area.

8. **Public demo on GitHub Pages** (requested by the user, 2026-10-30): a showcase page in the spirit of "little
   computer people": one or more live characters in a small scene, reacting to behaviour buttons, fake agent events
   and pokes, with panels to tweak the environment (wind, gravity, rope length, background) and motion (swing and
   twist damping, twist stiffness, limb stiffness, render sub-samples, reduced motion), and a live frame-time readout.
   It is built by a GitHub Actions workflow from the same bundle and character artifact on every push to `main`, so
   it never drifts from the source; the Playwright tests run against the built page before it deploys.

## Tests (Playwright, headless Chromium)

Playwright and its Chromium are added as dev dependencies (install via the safe-install skill). A tiny Node static
server is started by the test; nothing is deployed.

| Test | Pass condition |
|---|---|
| Real-time budget | Idle for 5 s at 64 px: p95 frame time at most 40 ms (24 fps). Record mean, p95 and max. |
| Hit reaction | After `hit()`, the swing angle rises above 10 degrees within 0.5 s, the legs and mane move, and the character settles below 2 degrees within 6 s. |
| Behaviour switching | `idle` -> `think` -> `busy` -> `celebrate` -> `fail` -> `idle`: no errors, no frozen frames, and at each switch the frame-to-frame pixel change stays below 3 times the median change. |
| Determinism | The same seeded event sequence gives identical frame hashes in Chromium and in Node. |
| No console errors | Zero errors or warnings in the page console. |
| Composition gates | Mask ownership, additive bounds and physics continuity from the composable behaviours spec hold for every behaviour. |
| Event bridge | Dispatching `loading`, `toolStart`, `error`, `success` on the page drives the matching behaviours, in order, with no errors. |
| Poke and drag | A click on the character triggers a hit; dragging the body and releasing makes it swing from where it was let go. |
| Reduced motion | With `prefers-reduced-motion: reduce` emulated, peak swing and spin stay below half of the normal values. |
| Page unaffected | Clicks on page elements outside the character's box still reach them. |
| Stills | Screenshots and an 8-frame strip of each behaviour saved for review. |

Headless Chromium timings are an estimate of a real browser tab; the report says so and gives the manual command.

## Decision after the spike

- **p95 at most 40 ms with acceptable quality:** the procedural renderer is good enough for live previews; plan the
  runtime product with it and add skins later.
- **Over budget:** measure the skins compositor (part sprites placed per frame) on the same page; if it fits the
  budget, the runtime uses skins from the start.
- In both cases, record what online motion required, since the same incremental planner is needed for walking
  characters in the runtime.
