# Pinata

Pinata is an experiment in AI-driven character animation. An AI agent describes a character as text (a mannequin of
simple volumes, materials, a behaviour script), and the tooling does what an AI finds hard to do by hand: physics,
inverse kinematics and secondary motion such as a cape swinging after a turn. Output is rendered as pixel art, with
numeric diagnostics and still images an agent can read to check its own work.

The repository is in a proof-of-concept phase. Each idea is proven in isolation against gates fixed before the code
was written, and visual quality is judged by blind, calibrated AI judge panels rather than by eye.

## Findings so far

| Proof | Question | Result |
|---|---|---|
| P1 static style | Can a procedural renderer turn a 3D mannequin into pixel art that passes as hand-made at 32-64px? | No. Readable and consistent across 8 directions, but blind judges picked the hand-made reference in 36 of 36 comparisons, before and after a targeted style revision. |
| P3 secondary motion | Does a simulated cape read as inertia, with materials and wind distinguishable by motion alone? | Yes. All gates pass, a rigid-cape control fails them, and blind judges ranked silk, wool and leather correctly and read the wind direction in every case. |
| P4 locomotion | Does a behaviour script compile into planted, non-sliding footsteps with IK legs? | In progress. |

The working conclusion is that the value is in the motion engine (scripted physics, IK and secondary motion with
machine-checkable diagnostics), with visuals supplied by art made elsewhere rather than by a procedural style.

## Running it

Requires Node.js 24 or later; TypeScript runs directly through Node's type stripping, with no build step.

```bash
npm install
npm test            # unit tests
npm run typecheck   # tsc, no emit
npm run p1          # P1: render the knight in 8 directions, evaluate gates, write reports/p1/
npm run p3          # P3: simulate cape and plume in three scenarios per material, write reports/p3/
```

Each proof-of-concept runner exits 0 when all gates pass, 1 when a gate fails and 2 when the harness itself fails,
and writes a `summary.txt`, `metrics.json` and still images to `reports/<poc>/`. P1 also writes `preview.html`.

## Repository layout

- `src/`: the library, one directory per component (formats, raster, style, sim, motion, diagnostics).
- `pocs/`: one directory per proof of concept, with its assets, gates and runner.
- `test/`: unit tests.
- `refs/`: CC0 reference sprites used in the P1 judge panel, with sources in `refs/LICENSES.md`.
- `docs/plans/`: the viability design, the plan for each proof, findings logs and the judge panel artefacts.

## Further reading

- `docs/plans/2026-10-30-viability-design.md`: requirements, components, proofs and the AI judge panel method.
- `docs/plans/p1-findings.md` and `docs/plans/p3-findings.md`: every tuning run and judge result.

## Licence

MIT, see `LICENSE`. The reference sprites in `refs/` are CC0 works by their respective authors.
