# Automated Checks

Most rework in recent batches came from steps done by hand and rules checked by eye: gate measurements that
flattered (the skeleton measured instead of the drawn pixels, a mode instead of every frame, the line under the root
instead of each foot's own ground point), checks that could not fail, verification steps skipped after a late edit,
judge panels with a leaked name, strips 2 px apart, no controls or a judge's answers not written, and repository
rules (line length, journal phrasing, comments, dead links) found in review. This plan turns each into code, so a
batch either passes them or says exactly what failed.

## Design

- **`npm run verify`.** One command runs, in order and every step even after one fails: `typecheck`, `test`, the style
  lint, the example gates, the site build and the browser suite (orphaned headless Chrome cleaned up first), and the
  byte-identical checks: `rendering-panel` and the `gates` output compared with stored baselines. It prints one line per
  step (pass, fail, changed) and a summary; it exits non-zero when any step fails or any output changed. `npm run verify
  -- --accept <step>` stores the current output as the step's new baseline when a change is meant, and prints what
  changed, so a meant change is a deliberate, visible act. Baselines are hashes and line files kept out of the
  repository (they depend on the machine's engine), under `reports/baselines/`.
- **Style lint (`npm run lint`).** Code: no comments, lines within 120 columns. Documents: lines within 120 columns
  outside tables and code blocks, relative links that resolve, no dates or journal phrasing in `docs/` outside
  `docs/plans/done/` (a short list: "now", "no longer", "was changed", "at first", "first version", dates). Each
  finding names the file and line.
- **Example gates (`npm run examples`).** Every example character through `pinata check`, and every skinned one
  through `pinata export`, exiting non-zero if any author gate fails.
- **Judge runner (`npm run judge -- run <panel.json> <dir>`).** Builds the packet, lints it (a neutral name: no word
  of an item id, file name or the question's options; at least one control for pairwise panels; strips in the
  stacked layout; the key outside the packet), starts three fresh judges with `claude -p` on three models (largest,
  middle, smallest), each with only the packet folder readable and the instruction to answer in JSON on stdout,
  validates every answer (all items, allowed choices, ratings), retries a judge once on a malformed answer, saves the
  answers and prints the score. Judges' answers are parsed from their output, never from files they were asked to
  write.
- **Gate specs with controls.** A gate is declared with what it observes (drawn pixels, joints, files), its
  reference frame, its threshold, and a known-bad and a known-good case: small hand-made inputs on which it must fail
  and pass. The test suite runs every gate's cases, so a gate that cannot fail, or measures the wrong frame, fails
  before any batch reports a number. The export gates are the first to move to it; later gates are written this way.
- **The rules in CLAUDE.md:** a batch is done when `npm run verify` passes; visual gates run through the judge
  runner; new gates come with their failing and passing cases.

## Gates (fixed before implementation)

| Gate | Threshold | Notes |
|---|---|---|
| Existing outputs | byte-identical | the checks add tooling only |
| Verify catches what it should | on a scratch branch: a deliberately failing test, a changed page pixel (a skin tweak), a line over 120 columns and a dead link each make `verify` exit non-zero naming the step and the file; the unchanged tree passes | one case per step |
| Judge runner | one real panel (the batch D exit test's) runs end to end with no manual step; a packet with the panel's name containing an item id, or with no control, is refused | |
| Gate cases | every export gate has a failing and a passing case in the tests; each case fails when its gate's comparison is flipped | checked by flipping each by hand once |

## Batches

- **A. Verify, lint and example gates:** the three commands, baselines, the verify gate. Review.
- **B. Judge runner:** `judge run`, the packet lint, the runner gate on a small test panel. Review.
- **C. Gate specs:** the declaration, the export gates moved to it with their cases, the gate-cases gate; CLAUDE.md
  rules. Review.
