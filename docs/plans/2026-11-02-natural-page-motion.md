# Natural Motion on the Page, Game-Like Visuals

**Goal:** characters on the page move like game characters, not posed figures: capes, robes, plumes and scarves
swing and trail; falls have a take-off, an airborne pose and a landing that absorbs the impact; characters jump up
onto what they can reach; parts never pop in or out. Judged against the old terrain demo and against strong
references.

The page world runs only the motion-capture player. The terrain world also ran spring chains (the knight's plume, the
rogue's scarf) and cloth (the knight's and dwarf's capes); skins drew capes as rigid sprites even there, and the
wizard's robe has no simulation at all. Falls are a body sliding down under gravity while the clip plays on.

## Design

- **Secondary motion, shared:** the spring chains, cloth and the head's nod that `world.ts` runs are moved into one
  module both worlds use, and the page cast runs them for every character, with the page's wind (none by default)
  and gravity. Every appendage part moves unless the character marks it rigid.
- **Cloth in skins:** a skin draws cloth (capes, robes, the hem of a robe) from the simulated particles in its own
  palette: the cloth sheet filled with the skin's colours by shade (light from above, folds darker), outlined like the
  sprites, and drawn in the depth order of its anchors. Chains (plume, scarf) are drawn the same way along their
  links. The wizard gets a robe hem: a cloth skirt hung from the hips. A skin may name the colours its cloth uses.
- **Falls and landings:** an airborne phase (arms out, legs reaching down, from springs and the airborne clip frames),
  and a landing reaction: the body dips at impact by an amount and for a time that grow with the landing speed, the
  knees take it with the feet held, then recovers; big drops add a recovery step.
- **Jumps:** CMU takes for jumping up, jumping down and landing join the database; the motion matcher picks them by
  vertical speed. The surface graph gains jump edges up to a height the character can reach (a share of leg length),
  the walker plans an arc, and characters climb back up the page; drop-ins become a fallback.
- **Structural draw order and one anchor:** a part attached to another (helmet on head, visor on helmet, face on
  head) draws above its parent by rule; order between independent parts switches with hysteresis; sprites are
  anchored to the body everywhere.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical, except the terrain world's captured actors and outputs named as meant to change | |
| Cloth moves | in Node on the demo layouts, over a minute of walking, the lowest row of the knight's cape, the dwarf's cloak and the wizard's hem moves relative to the pelvis by at least 3 cm RMS, and trails the walking direction on average | the cloth is alive |
| Chains move | the tips of the knight's plume and the rogue's scarf lag their anchors by at least 2 cm RMS while walking | |
| Wind | with a 3 m/s wind, the mean offset of the cape's lowest row from the pelvis points downwind by at least 5 cm | |
| Cloth stays outside the body | no cloth particle more than 1 cm inside a body part the cloth does not exclude, over every scenario | |
| Skins show cloth | in rendered page frames the cape's pixels change frame to frame with its motion (its silhouette differs between the two extremes of a stride) and add at most 1% flicker beyond P2's measure | |
| Landing absorbs | for drops of 0.6, 2 and 5 m, the deepest knee flexion within 0.5 s of landing grows with the drop and is at least 35 degrees at 5 m; the pelvis dips at least 4 cm at 2 m; no sole goes through the surface | every humanoid |
| Recovery | after any landing the character is walking or resting normally (feet held, no mid-air) within 1.5 s | |
| Jumps | on recorded layouts with rises up to the jump height, at least 95% of planned jumps land on the surface they aim for, and nobody climbs a rise above the jump height | |
| No popping | over a minute on every recorded layout, no part of any character vanishes for one to three frames and comes back (pixel count of its colours to zero and back) unless a part nearer the camera covers it | structural draw order |
| Cost | the page world with four characters, cloth and chains on, at most 8 ms of main thread per frame at p95 in Chrome | |
| Natural motion | blind judge panel, walk and fall-and-land strips of each character: the new page world is preferred over the current page world in at least 75% of non-control answers, and is rated at least as natural (1-5) as the old terrain demo with skins | judges, both orders, controls |
| Game-like | blind judge panel as P7's quality gate, on page-world walk and landing strips: mean rating at least the references' mean, and "made by software" picked in at most 60% of non-control answers | the visual bar |

## Batches

- **A. Secondary motion on the page:** the shared module, chains and cloth in the page cast, the wizard's hem, the
  cloth, chain, wind and inside-the-body gates; cost in Chrome. Review.
- **B. Cloth in skins:** rendering cloth sheets and chains in the skin's palette; the skins-show-cloth gate; the
  natural-motion panel against the current page. Review.
- **C. Falls and landings:** the airborne phase and the landing reaction; the landing and recovery gates. Review.
- **D. Jumps:** CMU takes, jump edges and arcs; the jumps gate; drop-ins as a fallback. Review.
- **E. Structure and the bar:** structural draw order with hysteresis, one anchor; the no-popping gate; the
  natural-motion and game-like panels; release. Review.
