# P6 Findings

Gates fixed in [`docs/plans/2026-10-30-remaining-proofs.md`](2026-10-30-remaining-proofs.md) before implementation.

## Setup

Two characters, [`examples/knight`](../../examples/knight) and [`examples/dwarf`](../../examples/dwarf) (the dwarf authored by an AI agent in P5), each rendered in
three styles: the P1 default, `muted` and `vivid` (written by an agent from one-line briefs;
[`pocs/p6-style-swap/`](../../pocs/p6-style-swap)). The dwarf's materials missing from the P1 default were mapped onto existing ramps in the
runner, without editing the character.

## Results

- Gates, all pass: motion data (pose and cloth frame hashes) identical across the three styles for both characters;
  every style passes the P1 static gates on both characters (maxThinFraction at exactly 0.25 everywhere, the knight's
  standing margin); turntable flicker at most 0.008 (31 frames at 1 degree per frame, shorter than P2's); vivid dwarf
  at exactly 16 colours; deterministic. Runtime about 97 s.
- Style iteration: the first `vivid` used separate 4-shade ramps per material (21 colours, over the limit, plus stray
  pixels and flicker); rebuilt as four shared hue ramps, then band thresholds adjusted. Gates untouched.
- `motionIdentical` is largely structural (motion never reads the style), but each style's run simulates and hashes
  independently.

## Judge panel

Six 3/4-view stills, shuffled and unnamed. All 3 judges grouped them correctly both by character and by style, at
confidence 5. Artefacts in [`docs/plans/p6-judge/`](p6-judge).

## Verdict

P6 passes: style is independent of motion. One character and its motion render in clearly different styles that
blind judges still recognise as the same character, and the styles themselves are recognisable across characters.
