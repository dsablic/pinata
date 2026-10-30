# P5 AI Authoring Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan in batches.

**Goal:** Prove that an AI agent with no human help can author a new character (body, materials, style, rig, cape or
hair, motion) from a one-line text prompt, using only the tool's documentation and its diagnostics, and reach a
passing result within a small budget of runs. Design: `docs/plans/2026-10-30-viability-design.md`, section "P5 AI
authoring loop".

**Architecture:** A character is a directory of text files. One command, `npm run check -- <dir>`, validates the
whole package, runs the existing proofs' checks on it (P1 static readability, P4 locomotion, P3 cloth stability),
writes stills an agent can look at, and prints a summary with actionable failures. The experiment then gives fresh
agents a prompt, the authoring guide and the command, and measures what they achieve.

This also closes an integration gap: P3 simulated cloth on a body that glided rigidly; P5 simulates it on a walking
body posed by P4.

---

## Batch A: cloth on a walking body

### Task A1: Posed collider and pins (`src/sim/solver.ts`, `src/sim/body.ts`)

`step` today builds the collider and pin positions from the rest mannequin moved by the root. Add an optional
`pose?: (t: number) => Pose` to the step options: when present, the collider and pins use `posedMannequin(m,
pose(t))`. A frame's pose is held constant across that frame's substeps, so `pose(t)` returns the pose of the
frame containing `t`. Tests: with a pose function that returns the rest pose, results are byte-identical to today;
a pin on a joint that the pose moves follows it; a particle resting on a moving leg part is pushed with it.

### Task A2: Walking simulation helper (`src/motion/character.ts`)

```ts
export function simulateCharacter (options: { mannequin, rig, scenario, materials }): CharacterRun
// CharacterRun: gait frames, poses (body-local), cloth recording, timing
```

Plans the gait from the scenario's script (P4), poses every frame, and simulates the scenario's cape and chains on
the posed body (P3), with the same substep and recording conventions as the P3 runner. Tests on the synthetic
fixtures: deterministic; the cape follows a walking body; no NaN.

Review batch A.

## Batch B: the character package and `check` command

### Task B1: Package format (`src/formats/character.ts`)

A character directory holds:
- `character.json`: `{ name, description, mannequin: "mannequin.json", style: "style.json", rig: "rig.json",
  materials: "materials.json", motion: "motion.json" }` (file names configurable, defaults as shown).
- `motion.json`: a P3-style scenario without `name`/`body`/`bodyExcludeParts`, plus `exclude` (parts that are cloth
  stand-ins and should not collide, optional).
All existing validators apply; add `loadCharacter(dir): Validated<Character>` that reports errors per file with
`file: path: message`, and cross-checks (rig against mannequin, style materials against mannequin parts, cape and
chain joints, sim materials).

### Task B2: `check` command (`src/cli/check.ts`, `package.json` script `check`)

`npm run check -- <dir> [--out <dir>]` (default output `<dir>/report/`):
1. Validate (exit 2 with every error listed if invalid).
2. Static readability (P1 gates): render 8 directions at 32 and 48px, elevations 0 and 30; outlineGaps,
   maxThinFraction, paletteSize, maxStrayPixels.
3. Locomotion (P4 gates): footSlidePx, groundPenetrationPx, reachViolations, kneeLimitViolations,
   kneeSpeedDegPerSec, boneLengthError, rootSpeedError, alternationViolations; plantedFrames > 0 per foot.
4. Cloth (P3 gates that don't need a material comparison): nonFinite, maxSpeed, maxStrain, penetratingFrames;
   skipped if the character has no cape or chains.
5. Write `summary.txt` (one line per gate with PASS/FAIL, value, threshold, and for each FAIL a one-line hint naming
   the likely fix, e.g. "maxThinFraction 0.40 on part 'tail' at 32px: make it at least 0.11 m across or set
   allowThin"), `metrics.json`, and stills: `sheet.png` (contact sheet), `walk.png` (pixel strip of 8 walking
   frames, side view), `footprints.png`, `cloth.png` (body-frame onion skin of the cape during the walk, if any).
6. Exit 0 if all gates pass, 1 if any fails.
Gate thresholds are imported from the proofs' `gates.ts` files, not copied.
Tests: a valid fixture character passes; an invalid one exits 2 with errors from more than one file; a hint appears
for a failing gate. Runtime target: under 60 s for a character like the knight (determinism is not re-checked here;
P1, P3 and P4 already prove it).

### Task B3: Authoring guide (`docs/authoring.md`)

Reference documentation for an agent that has never seen the project: the coordinate conventions, every file and
field with types, ranges and a short example, how parts, joints, decals, rig groups, materials and motion relate,
what each gate measures and the usual fix, and a complete small example character (not the knight). The guide plus
the command must be enough; the experiment gives agents nothing else. Keep it under about 600 lines.

Review batch B.

## Batch C: the experiment (controller)

Three prompts, chosen to stress different parts:
1. "A hooded rogue with a long scarf that trails in the wind."
2. "A short, stocky dwarf with a heavy fur cloak and a big axe."
3. "A tall, thin wizard with a pointed hat and a long flowing robe."

For each prompt, one fresh agent (no project context) gets: the prompt, `docs/authoring.md`, a working directory, and
permission to run only `npm run check -- <dir>` and read its report (including the PNGs). Its instructions: create the
character, run the check, fix and re-run until all gates pass or 10 runs are used, never edit anything outside the
working directory, then report. The controller records every run's summary.

Gates (fixed now):
- For each prompt: all `check` gates pass within 10 runs.
- Every format error is fixed within 2 attempts (the run after an exit-2 run validates, or the one after that).
- Prompt match, judged blind: 3 fresh judges see the three final contact sheets (shuffled, unnamed) and the three
  prompts and match them. Pass if each judge matches all three correctly (chance 1 in 6 per judge), or at least 2 of
  3 judges do.
- No agent edited files outside its working directory (checked with `git status` and a file listing).
Findings, including where agents struggled and which hints helped, go in `docs/plans/p5-findings.md`.
