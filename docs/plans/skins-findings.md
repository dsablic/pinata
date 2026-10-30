# Skins Spike Findings

Gates fixed in `docs/plans/2026-10-30-remaining-proofs.md` before implementation.

## Artist

A fresh agent with only the brief and the preview command drew a 21-part, 16-colour skin
(`pocs/skins-spike/artist-skin.json`). It validated on the first run and the agent used 2 of 6 previews. Gate (finish
within 3 attempts): pass. Rule slip: it patched its JSON with a small Python script, though the preview was the only
permitted command; it changed nothing outside its folder. Its notes: the 48 px torso (about 9 by 12 px) leaves little
room for detail and is mostly hidden by the near arm, 16 colours are tight, and 22.5 degree rotation steps make
rotated limb edges jaggy.

## Judge panels

Packet: the skinned knight's standing frame vs the three CC0 references from P1, both orders, plus 4 hand-made vs
hand-made controls; and the 8-frame walk strip, skins vs the P4 procedural walk, both orders. Key and every answer in
`docs/plans/skins-judge/`.

| Round | Wording | Reference picked (of 18) | Controls "can't tell" (of 12) |
|---|---|---|---|
| 1 | "assembled by software from part sprites" | 10 | 6 |
| 2 | same, fresh judges | 0 | 0 |
| 3 | P1's exact wording, fresh judges | 0 | 0 |

- The pre-registered validity rule (controls "can't tell" in at least 10 of 12) failed in every round, so the A/B
  gate is **inconclusive**, not a pass.
- The pattern is nonetheless clear: across 9 judges the skinned knight was rated more hand-made than the reference in
  44 of 54 comparisons. In P1 the procedural knight lost 36 of 36.
- Why the controls failed: once the candidate no longer looks obviously machine-made, judges stop recognising
  hand-made work and start ranking quality, so they pick sides between references too (consistently preferring the
  small plumed knight over the teal and grey ones, and calling the latter "mechanical" or "generated"). The control
  design assumed a detection task; with a competitive candidate it becomes a ranking task.
- Caveat: the references are modest CC0 sprites; this shows skins are competitive with them, not with expert work.
- Walk strip: the majority preferred the skins walk in both orders (round 1: 2 of 3 judges each order). Gate: pass.
  In P4, the procedural walk could not be told apart from a sliding control at all.

## Verdict

The skins spike passes two of its three gates (artist, walk) and is inconclusive on the A/B gate, with a strongly
favourable pattern. AI-drawn per-part sprites driven by the rig are the most promising visual layer found so far:
they turn the motion engine's correct but plain output into pixel art that blind judges rate at or above modest
hand-made references.

Lessons for later judge panels: use references of known, high quality; add a quality-rating question alongside the
detection question; and keep wording identical across rounds.
