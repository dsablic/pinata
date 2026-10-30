# Piñata

<p align="center">
  <img src="docs/assets/logo.gif" alt="A fat pixel-art unicorn piñata hanging from a rope, hit every few seconds, swinging with its limp legs, rainbow mane and tail flopping (simulated cloth physics, seamless loop)" width="400">
</p>

Piñata is a character animation engine built for AI agents, and it is a work in progress. An agent describes a
character as text: a mannequin of simple volumes, a rig, materials and behaviours. The engine then does what an
agent finds hard to do by hand: walking on uneven ground, inverse kinematics, physics and secondary motion such as a
cape swinging after a turn. It renders pixel art and reports numeric diagnostics and still images, so an agent can
check its own work.

## What works

- **Characters as text:** humanoids, quadrupeds, hexapods, octopods and creatures with general limbs (tails, ears,
  manes), checked by `npm run check` and started from templates with `npm run new`. See
  [`docs/authoring.md`](docs/authoring.md).
- **Motion:** footstep planning with IK legs on flat ground, ramps and stairs; spring-driven appendages; simulated
  cloth (capes, scarves, chains) with wind and gravity; a joint hierarchy for attached parts.
- **Rendering:** a procedural pixel-art renderer that stays stable in motion, with interchangeable styles.
- **Live runtime:** characters animate frame by frame in the browser and in a terminal pane.
  - **The world:** a cast of characters living on procedurally generated terrain, wandering, visiting each other,
    resting and reacting to pokes and weather. The whole world is [one declarative config](site/world.json).
  - **The hanging piñata:** a character on a rope you can poke, drag and tune. Embed it with
    `<pinata-character src="unicorn.json"></pinata-character>` and send it events with
    `window.dispatchEvent(new CustomEvent('pinata', { detail: 'toolStart' }))`.
  - **In Claude Code:** the `pinata` mod shows the piñata in a pane beside the chat, reacting as the agent works. In
    this repository it is enabled once you trust the folder; elsewhere run
    `/plugin install pinata --marketplace dsablic/pinata`, then `/pinata` opens the pane. It needs Node.js 24.
- **Checking quality:** every feature is built against gates fixed before the code, and visual quality is judged by
  blind AI judge panels (`npm run judge`, see [`docs/judging.md`](docs/judging.md)).

## In progress

- **Natural motion from motion capture** ([plan](docs/plans/2026-10-30-motion-data.md)): humanoids driven by
  retargeted CMU motion capture through motion matching, with their feet locked to the terrain and a physical body
  leading. Clips and retargeting are done; playback is under way.
- **Physical bodies** ([plan](docs/plans/2026-10-30-physical-walking.md)) for creatures without motion-capture data.
- Then weather and particles, character skins, a physics engine, and pages whose elements become terrain. The
  [roadmap](docs/ROADMAP.md) and [TODO](docs/TODO.md) have the order.

## Running it

Requires Node.js 24 or later; TypeScript runs directly through Node's type stripping, with no build step except for
the browser bundle.

```bash
npm install
npm test                       # unit tests
npm run typecheck              # tsc, no emit
npm run runtime                # build the site and serve the world at http://127.0.0.1:8080/
npm run check -- examples/knight                 # check a character package
npm run new -- --template hexapod my-bug         # write a starter package (biped, quadruped, hexapod or octopod)
npm run judge -- build panel.json packet/ key.json   # build a blind judge panel
npm run mocap -- convert motion/takes.json <cmu-dir> motion/clips   # rebuild the motion clips
npm run demo                   # render the walking piñata demo to reports/demo/
```

The original proof-of-concept runners (`npm run p1` to `p6`, `skins`, each with a `:verify` variant that adds a
determinism re-run) still work and keep their outputs byte-identical. They write reports to `reports/<poc>/` and exit 0
when every gate passes, 1 when one fails and 2 when the harness itself fails.

The [showcase site](https://dsablic.github.io/pinata/) is rebuilt by CI for every release tag, so it can lag behind
`main`.

## How it got here

The project started as a series of proofs of concept, each testing one idea in isolation against fixed gates and
blind judge panels. In short: procedural pixel art is readable but does not pass as hand-made (P1); it stays stable in
motion (P2); simulated capes read as inertia, material and wind (P3); scripted footsteps with IK legs work (P4); a fresh
AI agent can author a character from a one-line prompt (P5); style is independent of motion (P6); and AI-drawn part
sprites look promising (skins spike). The conclusion was that the value is in the motion engine, which is what is now
being built. [`docs/FINDINGS.md`](docs/FINDINGS.md) has the details.

## Repository layout

- [`src/`](src): the engine, one directory per component: `formats` (character files and validation), `motion`
  (gait, IK, appendages), `sim` (cloth), `raster` and `style` (rendering), `world` (terrain and the live world),
  `mocap` (motion-capture clips and retargeting), `runtime` (live characters), `judge`, `diagnostics` and `cli`.
- [`examples/`](examples): character packages: the knight, rogue, dwarf and wizard, a dog, a horse, a beetle, a spider,
  and the piñata and unicorn piñata.
- [`motion/`](motion): motion-capture clips converted from the CMU database, with their sources.
- [`site/`](site): the showcase pages and the world config.
- [`mods/pinata/`](mods/pinata): the Claude Code mod.
- [`pocs/`](pocs): the proof-of-concept runners, with their assets and gates.
- [`test/`](test): unit tests.
- [`refs/`](refs): CC0 reference sprites from the P1 judge panel, with sources in [`refs/LICENSES.md`](refs/LICENSES.md).
- [`docs/`](docs): the [roadmap](docs/ROADMAP.md), [TODO](docs/TODO.md), [findings](docs/FINDINGS.md),
  [authoring guide](docs/authoring.md), [judging guide](docs/judging.md), and [plans](docs/plans) with their gates and
  findings logs.

## Licence

MIT, see `LICENSE`. The reference sprites in [`refs/`](refs) are CC0 works by their respective authors. The motion
clips come from the [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu), which may be copied, modified
and redistributed but not resold; see [`motion/README.md`](motion/README.md).
