# Working on Piñata

## Code

- TypeScript only, run directly by Node 24 (type stripping, no build); the browser bundle is built with
  `npm run build:web`. Standard style: no semicolons, single quotes, two-space indent, lines within 120 columns.
- No comments in code: no doc comments, no inline comments. Clear names and small functions say what the code does.
- Implementation choices and their reasons go in [`docs/design.md`](docs/design.md), under the module's heading,
  updated in place when a choice changes.
- Code and tests are DRY: shared logic and fixtures live once and are reused.
- Tests check behaviour that could break: no low-value tests (a constant compared against its value, a type's shape,
  code restated as an assertion). Each test should be able to fail for a real defect.
- Existing outputs stay byte-identical unless a change is meant to alter them.

## Documents

- State decisions as they stand: no dates, no attributions, no journal entries. The commit log is the history.
- Plans in [`docs/plans/`](docs/plans) fix their gates before building; gates are only tightened afterwards.
- [`docs/TODO.md`](docs/TODO.md) says what is next; [`docs/ROADMAP.md`](docs/ROADMAP.md) the longer plan.

## Checking work

- A batch is done when `npm run verify` passes: typecheck, tests, `npm run lint`, `npm run examples`, the site build
  and browser suite (Chrome, driven over the DevTools protocol), and the rendering panel and gates output against
  their baselines. A meant output change is accepted with `npm run verify -- --accept <step>` and named in the plan's
  results. `--only` and `--skip` are for speed while working.
- After each batch, an independent review told to assume the code is wrong; fix what it finds.
- Visual quality is judged by blind judge panels run with `npm run judge -- run` (see
  [`docs/judging.md`](docs/judging.md)): fresh agents, neutral names, both orders, controls; gates count every
  answer, can't-tell included.
- New gates are declared with `declareGate` (`src/checks/gate-spec.ts`): what they observe, their reference frame, their
  threshold, and a failing and a passing hand-made case; `npm test` runs every declared case.
- New npm packages only through the npm-safe-install scan.

## Commits

- A short subject, no body unless needed, the Co-Authored-By trailer. Push at milestones; release by tagging `v*`.
- Write the name as "Piñata" in prose and `pinata` in identifiers, paths and commands.
