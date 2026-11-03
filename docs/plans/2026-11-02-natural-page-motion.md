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
- **Cloth in skins:** the joints a skin draws its cape, cloak, robe and scarf sprites on are bound to the simulated
  cloth, so the artist's sprites swing with it, as game sprites on bones do; no cloth is
  drawn from scratch, and the pixel art stays the artist's. The wizard gets a robe hem: a cloth back panel hung from
  the hips, its hem joint bound to it.
- **Falls and landings:** an airborne phase (arms out, legs reaching down, from springs and the airborne clip frames),
  and a landing reaction: the body dips at impact by an amount and for a time that grow with the landing speed, the
  knees take it with the feet held, then recovers; big drops add a recovery step.
- **Jumps:** CMU takes for jumping up, jumping down and landing join the database; the motion matcher picks them by
  vertical speed. The surface graph gains jump edges up to a height the character can reach (a share of leg length),
  the walker plans an arc, and characters climb back up the page; drop-ins become a fallback.
- **Structural draw order and one anchor:** a part attached to another (helmet on head, visor on helmet, face on
  head) draws above its parent by rule; order between independent parts switches with hysteresis; sprites are
  anchored to the body everywhere.

### How batch D builds it

- Jump mechanics first, gated before any new capture. The surface graph (`graph.ts`) gains jump edges, only where a
  caller gives a jump height and reach: from a node up to another whose top is more than a step and at most one leg
  length above (knight 0.70 m, wizard 0.79, rogue 0.44, dwarf 0.34), across a gap of at most 1 m, with the take-off
  far enough back to be above the top at its edge, and the body's head room and walls clear. The walker plans over
  them (preferring the take-off nearest to where it is), walks to the take-off, and commands the player to jump to
  the target's x and height; the player crouches (the landing dip, peaking at 0.18 s), launches on a ballistic arc
  that lands on the target, lifts its soles over the target's top, reaches its legs down after the apex and lands
  with the dip. A jump that would miss is refused and the walk is given up.
- The page cast turns jumps on. The recorded demo and page layouts have rises of 1.5 to 5 m, beyond a human jump, so
  no jumps happen there; the jumps gate runs on a recorded jump page (`test/pages/jump-test.html`, layout `jumps`)
  with rises up to and just above each character's jump height, and on synthetic grounds as a supplement.
- Then CMU takes for take-off and landing join the database, picked only while jumping (by vertical speed), so walking
  never matches them.

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
- **B. Cloth in skins:** joints bound to the cloth, carrying the skin's sprites; the skins-show-cloth gate. The
  natural-motion panel runs in batch E, with the fall-and-land strips it names. Review.
- **C. Falls and landings:** the airborne phase and the landing reaction; the landing and recovery gates. Review.
- **D. Jumps:** CMU takes, jump edges and arcs; the jumps gate; drop-ins as a fallback. Review.
- **E. Structure and the bar:** structural draw order with hysteresis, one anchor; the no-popping gate; the
  natural-motion and game-like panels; release. Review.

## Results

- **Batch A built and reviewed.** The shared secondary-motion module (`src/motion/secondary.ts`), run by the page
  cast for every character; the wizard's robe as a cloth back panel hung from the hips (a closed skirt failed the
  cloth gates: legs push through its front); the body's height handed to cloth through the root, so falls no longer
  push cloth through the body; extra collision passes on the page; cape and plume anchors moved just outside the
  body. The head's nod stays in the terrain world's procedural characters: captured heads move with the capture.
  - Cloth moves: on the two demo layouts over 90 s each (at least 60 s of walking per character in all), the hems
    move 7-27 cm RMS relative to the pelvis and hang further back walking than standing (knight 16-22 cm, dwarf
    2-6, wizard 16-39). **Pass.**
  - Chains move: plume and scarf tips lag their anchors 8-15 cm RMS while walking. **Pass.**
  - Wind: in a 3 m/s wind the knight's cape hangs 13-15 cm downwind of the pelvis (facing upwind and downwind
    weighted equally). **Pass.**
  - Cloth stays outside the body: no particle, pinned or free, more than 0.5 cm inside, calm or windy. **Pass.**
  - Cost: p95 5.9-6.9 ms on the demo and 4.4-5.5 ms on the test page in Chrome, with cloth and chains on. **Pass**,
    with less room than before (3.8 ms).
  - Existing outputs: the knight's, dwarf's and wizard's cloth reports change (anchors, collisions, the wizard's new
    panel); everything else is byte-identical. The terrain world's wizard now simulates its panel.
- **Batch B built and reviewed.** Joint bindings to cloth (`bind` in a character's motion): each bound joint gets a
  curve down its cloth from its part's first joint, held to the part's drawn length and to limited swing and bend;
  skins draw bound parts along their curves; softer cloth materials on the page; hysteresis on angles, fitted lengths
  and joint anchors, kept per character on the page. Fixed on the way: the wizard's back panel could end up in front of
  the body after a fall (its anchors now sit outside the robe, and it collides with it), and a standing character slid
  downwind in a strong wind (standing feet now hold).
  - Skins show cloth: over six 12 s windows (demo-1200 and demo-390, seeds 1-3) every bound part swings at least 10
    degrees more than rigid and keeps its length along its curve. The flicker part of the gate is open: the renderer is
    being reworked (see [unified part rendering](2026-11-02-unified-part-rendering.md)), and the gate is measured on
    that.
  - The natural-motion panel is run in batch E with fall-and-land strips, as its gate names them.
  - Existing outputs: the terrain world's captured actors change (bound joints, the wizard's panel, standing in
    wind), and the wizard's cloth report (its panel's anchors); the other reports and check outputs are byte-identical.
- **Batch C built and reviewed.** A landing dip in the player that grows with the landing speed and levels off by leg
  length; feet reaching down while falling, with no clip contact in the air. `npm run gates --
  --landings` drops every humanoid from 0.6, 2 and 5 m onto a floor (`src/diagnostics/landings.ts`).
  - Landing absorbs: knee flexion within 0.5 s of 57/68/75, 55/66/74, 56/66/74 and 56/67/75 degrees (knight,
    rogue, dwarf, wizard, by height), growing with the drop and over 35 at 5 m; pelvis dips at 2 m of 9.0, 5.7, 4.3
    and 10.2 cm; no sole under the floor. Before: no dip, and the same knee angle at every height. **Pass.**
  - Recovery: back to normal (pelvis within 3 cm of resting, feet held or swinging low, none in mid air) in 0.25,
    0.42 and 0.58 s for the knight, 0.17-0.46 for the rogue, 0-0.42 for the dwarf and 0.29-0.58 for the wizard,
    against 1.5 s. **Pass.**
  - The dwarf's dip at 2 m clears the 4 cm gate by 0.3 cm.
  - No recovery step after big drops yet: the dip alone meets the gates.
  - Other gates on the changed motion: the standing gates are as they were (34, 18, 40 and 61 frames in mid air);
    the cloth flicker windows moved with the falls, the dwarf's worst to 2.76% (2.56% before) and the wizard's to
    1.81%, both still missed. The terrain world's captured actors change wherever they fall (the plan allows it);
    planted feet slide no more after walk-off landings than before.
- **Batch D, jump mechanics built (CMU takes not yet).** Jump edges, the walker's jump legs and the player's jump
  (crouch, arc, refusal, landing); `npm run gates -- --jumps` (`src/diagnostics/jumps.ts`).
  - Jumps: a planned jump is a visit to a top that needs one; refusals, time-outs and short landings are misses. On
    the jump page plus six synthetic grounds, every character is at least 95% (all arrive; 90, 69, 53 and 93 trips
    for the knight, rogue, dwarf and wizard), nobody climbs a rise above their jump height, and no sole goes under a
    surface during a jump. **Pass.** An earlier count that only took trips reaching their take-off was flattering; the
    far-side take-off walked characters through the page and long floors timed out, both fixed (nearest take-off, a
    leg's time-out grows with its distance).
  - On the cast, the jump page gives about one jump a minute: wandering picks nodes by width, so the long floor wins.
  - Standing gates unchanged (34, 18, 40 and 61 frames in mid air on the four older layouts); landings still pass;
    knight pops 17 and dwarf pops 1 in the glitch survey, fragments 0, as before.
