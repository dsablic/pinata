# Working on Piñata

## Code

- TypeScript only, run directly by Node 24 (type stripping, no build); the browser bundle is built with
  `npm run build:web`. Standard style: no semicolons, single quotes, two-space indent, lines within 120 columns.
- No comments in code: no doc comments, no inline comments. Clear names and small functions say what the code does.
- Implementation choices and their reasons go in [`docs/design.md`](docs/design.md), under the module's heading,
  updated in place when a choice changes. Older modules still carry doc comments; move them there when touching them.
- Existing outputs stay byte-identical unless a change is meant to alter them.

## Documents

- State decisions as they stand: no dates, no attributions, no journal entries. The commit log is the history.
- Plans in [`docs/plans/`](docs/plans) fix their gates before building; gates are only tightened afterwards.
- [`docs/TODO.md`](docs/TODO.md) says what is next; [`docs/ROADMAP.md`](docs/ROADMAP.md) the longer plan.

## Checking work

- `npm run typecheck`, `npm test`, and `npm run site && npm run test:browser` (Chrome, driven over the DevTools
  protocol) before committing.
- After each batch, an independent review told to assume the code is wrong; fix what it finds.
- Visual quality is judged by blind judge panels (`npm run judge`, see [`docs/judging.md`](docs/judging.md)): fresh
  agents, neutral names, both orders, controls; gates count every answer, can't-tell included.
- New npm packages only through the npm-safe-install scan.

## Commits

- A short subject, no body unless needed, the Co-Authored-By trailer. Push at milestones; release by tagging `v*`.
- Write the name as "Piñata" in prose and `pinata` in identifiers, paths and commands.
