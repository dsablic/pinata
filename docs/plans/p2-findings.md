# P2 Findings

Gates fixed in `docs/plans/2026-10-30-remaining-proofs.md` before implementation.

## Results

- Without changes, turntable flicker at 32 px was 0.0126 (gate 0.01). Fix, allowed by the plan: temporal hysteresis
  in the rasterizer for sequences (a pixel enters or leaves the silhouette only when its coverage is more than 0.1
  past 0.5, and keeps its part while that part is within 2 samples of the winner). Single frames, so P1, are
  unchanged.
- Gates: flickerFraction 0.008 (32 px) and 0.006 (48 px), pass; outlineGaps 0 on turntable and walk, pass; the
  jittered-camera control flickers 0.34 and 0.25 and fails, as required; deterministic.
- `partAreaJump` fails: 0.33 (32 px) and 0.36 (48 px) against 0.15. Every flagged jump is a moving part covering
  another (for example the forearm sweeping across the thigh takes 5 of its 27 pixels in one frame) or the sword
  and cape changing silhouette as they rotate. The gate meant to exclude jumps with a motion cause, but its only test
  for one was "the part's bounding box moved", which misses occlusion. The definition was wrong, not the renderer;
  the gate is recorded as failed as specified rather than redefined after the fact. A future version should measure
  each part's unoccluded footprint.
- Walk flicker (reported, not gated): 0.07 (32 px) and 0.10 (48 px), from legitimately moving limbs.
- Cost: the hysteresis makes rendering sequential per frame; the runner takes about 4.5 minutes.

## Judge panel

Frame-difference strips, ours vs the control, both orders, 3 blind judges: all 6 answers picked the control as the
one that shimmers more, confidence 5. Artefacts in `docs/plans/p2-judge/`. This is an easy question (the control is
far worse), so it confirms the metric rather than testing a fine distinction.

## Verdict

P2 passes on its main question: with temporal hysteresis the procedural renderer stays stable under slow rotation
(flicker under 1%), clearly distinct from an unsnapped camera. One gate (`partAreaJump`) fails because its
definition counted occlusion as instability.
