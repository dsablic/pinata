# P5 Findings

Gates fixed in `docs/plans/2026-10-30-p5-authoring-loop.md` before implementation.

## Before the experiment

The batch A/B review checked `docs/authoring.md` against the code and tried to trigger every hint with broken
variants. It found the guide and hints pointing the wrong way on the most likely failure (sliding feet are usually
fixed by raising `stepHeight`, not lowering it), stale report files after a failed run, a thin-part hint that could ask
for a part to grow to its current size, a sole diagnosis that checked height instead of tilt, `height` not checked
against the parts (a loophole for the thin-part gate), and a dozen guide statements that did not match the code. All
were fixed before the experiment. A hint-following test on a goblin (not one of the prompts) reached a pass in 2 runs.

## Experiment

Three fresh agents, each with one prompt, `docs/authoring.md`, an empty folder and the `check` command (10 runs max).
The finished packages are in `examples/rogue/`, `examples/dwarf/` and `examples/wizard/`.

| Prompt | Runs to pass | Exit-2 (format) runs | Notes |
|---|---|---|---|
| Hooded rogue with a trailing scarf | 1 | 0 | Built on the guide's example proportions. |
| Stocky dwarf with fur cloak and axe | 4 | 0 | One run wasted by a failed `sed` edit; slide fixed by raising stepHeight, then knee speed by a longer stride; palette at exactly 16. |
| Tall wizard with pointed hat and robe | 6 | 0 | One run wasted by a failed `sed` edit; stray pixels only fixed by turning the beard into a decal. |

Gates:
- All `check` gates pass within 10 runs, for every prompt: pass.
- Format errors fixed within 2 attempts: pass (no run ever exited 2).
- Prompt match, blind: all 3 judges matched all 3 contact sheets to their prompts at confidence 5 (chance 1 in 6
  per judge): pass. Artefacts in `docs/plans/p5-judge/`.
- No edits outside the working directory: pass (repository unchanged after the experiment).

Process note: the dwarf and wizard agents wrote files with shell commands (`cat`, `sed`), although the check was the
only permitted command; both stayed inside their folders.

## What the authors found unclear or wrong

- Simulated cloth and chains are not drawn in the pixel-art stills; only parts are. All three authors added a static
  stand-in part (excluded from collision) so the cape, cloak or scarf would show. This is the main product gap found.
- The stray-pixel hint names parts but not pixels; the wizard only resolved it by replacing a small part with a decal.
  The guide should say small features next to larger parts work better as decals.
- Ground-penetration and root-speed hints point at joints or window length when the actual cause was a stride too
  long for the leg length (a long stride drops the pelvis).
- The slide and knee-speed gates trade off: raising stepHeight fixes slide and raises knee speed; a longer stride
  resolved it for the dwarf. The guide understates the stride's role.
- Palette budget: 5 materials x 3 shades + 1 decal colour = 16, the limit; the guide does not warn about this.
- "At least 0.072 m across" in a hint is a diameter, easy to misread as a radius.
- File editing on macOS: `sed -i` without `''` silently failed and cost two runs; agents need a reliable way to edit.

## Verdict

P5 passes. Fresh AI agents, with only the guide and the check command, authored three recognisable characters from
one-line prompts, each passing every static, locomotion and cloth gate within 1-6 runs, with no format failures. The
authoring loop (text formats, one command, actionable hints, stills) works.
