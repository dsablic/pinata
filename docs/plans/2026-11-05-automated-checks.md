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
  `docs/plans/done/` (a short list of journal phrases, and dates). Each
  finding names the file and line.
- **Example gates (`npm run examples`).** Every example character through `pinata check`, and every skinned one
  through `pinata export`, exiting non-zero if any author gate fails.
- **Judge runner (`npm run judge -- run <panel.json> <dir>`).** Builds the packet, lints it (a neutral name: no word
  of an item id, file name or the question's options; at least one control for pairwise panels; strips in the
  stacked layout, measured on the composed images), starts three fresh judges with `claude -p` on three models
  (largest, middle, smallest), each with only a temporary copy of the packet's files readable, outside the repository,
  and the instruction to answer in JSON on stdout, validates every answer (all items, allowed choices, ratings),
  retries a judge once on a malformed answer, saves the answers and prints the score. Judges' answers are parsed from
  their output, never from files they were asked to write.
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

## Results

- **A (verify, lint, examples).** `verify` caught each of the four planted defects (a failing test, a changed page
  pixel, a line over 120 columns, a dead link), naming the step and the file, and the unchanged tree passed. A full
  run takes about 8-20 minutes. One browser flake appeared in a full run and passed on rerun; `verify` prints how
  a failing step ended (exit status, signal or error) and reruns the browser suite once for the two leftover-browser
  failures.
- **B (judge runner).** A real two-pair panel (a walk strip against a skating strip, with a control of the same
  strip twice, stacked) ran end to end with no manual step: three judges, 17 s in all, about $0.14 in total, and
  the score printed. A panel whose name contained an item id, and a side-by-side panel of strips, were refused with
  exit 2 naming the problem; a panel with no control is refused by the spec check before the lint is reached.
  The tests cover each lint refusal, answer extraction (plain, fenced, prose around it, example objects) and
  validation with an injected fake judge, including the retry and the clear failure.
  An unscoped `Read` let a judge read `../key.json`; judges run in a temporary copy of the packet files, with the
  allow rule scoped to it. `npm run judge -- isolation` (a haiku judge asked to read a canary file one
  level above its folder and a file inside it) printed "the file in the folder was read; the file one level above was
  not read" and exit status 0.
- **C (gate specs).** The six export gates (feet, facing, border, ground, anchor, loop) are declared in
  `test/export-gate-specs.ts` with their frame, threshold and cases, and `test/gate-specs.test.ts` runs them. Each case
  builds a small recording and reads the gate's verdict from `checksOf`. Each comparison, routing rule and frame was
  flipped by hand, the cases run, and the flip reverted; every flip broke at least one case. The existing outputs stayed
  byte-identical (`gates` and `rendering-panel` the same as baseline).
  - feet: `report.ts` `<=` to `>` broke seven cases; `<=` to `<` broke the exact 1 px case; the sign of the root travel
    on x, on y, and dropping the wrap-around pair each broke their own case.
  - facing: `=== 0` to `!== 0` and inverting the sector comparison broke all the view cases; removing the turn
    exemption broke the turn case.
  - border: `=== 0` to `!== 0` broke every case; skipping a side row, swapping height and width at the bottom edge, and
    using the height for the right edge each broke the non-square edge cases.
  - anchor: `<=` to `>` broke all cases; `<=` to `<` broke the exact 0.5 px case; dropping `abs` on x broke the left
    case; dropping the y axis broke the above-the-pivot case.
  - ground: `<=` to `>` broke seven cases; `<=` to `<` broke one of twenty off; `>` to `>=` on the 1 px band broke
    the exactly-1-px cases; the line under the root instead of each foot's own point broke the pair of cases that differ
    in that frame; ground for every behaviour broke the walk case.
  - loop: `<=` to `>` and `<=` to `<` on the seam broke the seam cases; inverting the repeated-seam rule broke four
    cases; `median > 0` to `>= 0` broke the unmeasured case; loop for every track broke the non-loop case; idle no
    longer setting `holding` broke the idle case.
