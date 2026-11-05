# Running a blind judge panel

How to ask blind AI judges whether one set of images beats another, with the safeguards the proofs settled on (see
[`docs/FINDINGS.md`](FINDINGS.md), "How it was tested"): neutral names, every pair in both orders, a control the
judges must not be able to separate, the answer key kept out of the judges' folder, and three fresh judges per
question.

1. **Write a panel spec** (JSON). `a` is the candidate and `b` the reference in each pair; paths are relative to the
   spec file. At least one pair must be a control (`"control": true`): two references of similar, known quality.

   ```json
   {
     "name": "Skinned walk vs reference",
     "seed": "round-1",
     "question": "Which of the two looks more like it was drawn by hand by a pixel artist? Answer left, right or cant_tell.",
     "rating": "Rate how well crafted each sprite is, 1 (crude) to 5 (professional game art).",
     "scale": 8,
     "pairs": [
       { "id": "knight-vs-ref", "a": "frames/knight.png", "b": "refs/knight-ref.png" },
       { "id": "control", "a": "refs/ref-1.png", "b": "refs/ref-2.png", "control": true }
     ]
   }
   ```

   `name` names the panel in the key and the score only; judges never see it. `rating` asks for a 1-5 score for each
   side, which separates "both good" from "both bad"; it is optional, but the skins spike recommends always including
   it, and when present every answer must carry one. `scale` (default 8)
   and `gap` (default 2, in source pixels) set the layout; `layout` is `side` (default) or `stacked`, which puts the
   left image above the right one for wide strips; `background` defaults to `#c8c8c8`. Change `seed` for a
   new round to get a new order.

2. **Run the panel**:

   ```
   npm run judge -- run panel.json out/
   ```

   It builds the packet into `out/packet/` (`item-01.png`, ... and `questions.md`: each pair twice, sides swapped,
   shuffled by the seed; images trimmed to their opaque area, on one baseline, scaled up together) and the key into
   `out/key.json`, outside the packet. It lints the packet and refuses to run (exit 2, naming the problem) when the
   panel name shares a word of three letters or more (or the first four letters of a longer word: `Knights` and
   `knight`) with an item id, an image file name or (labelled panels) a label, when a pairwise panel has no control, or
   when a packet image is wider than three times its height (for wide strips use the `stacked` layout);
   `npm run judge -- lint panel.json` runs the same checks alone. It empties `out/packet/` and deletes stale
   `out/judge-*.json` first, copies the packet's files into a fresh temporary folder outside the repository, and
   starts three fresh judges there in parallel with `claude -p`, on `opus`, `sonnet` and `haiku`, each with only the
   Read tool, allowed only inside that folder (the folder is deleted afterwards), validates each answer against the
   panel, asks a judge once more (a fresh session) when its answer is malformed or incomplete, saves the answers
   as `out/judge-<model>.json`, and prints each judge's time and cost, then the score (as in step 4). A judge that
   stays malformed or times out fails the run (exit 1), naming the problems and its time and cost; no score is
   printed. A judge has ten minutes in all, across its two attempts.

   `npm run judge -- isolation` checks that a judge cannot read outside its folder: it asks a haiku judge to read a
   file one level above the folder and one inside it, and passes when only the inside one is read. It runs a real
   judge, so run it by hand when the judge's arguments or the CLI change; it is not part of `npm test`.

3. **By hand, when the runner cannot be used.** Build the packet with the key outside it:

   ```
   npm run judge -- build panel.json packet/ key.json
   ```

   then ask three fresh judges (new agents with no other context), each given only the `packet/` folder and told to
   follow `questions.md`. Save each judge's JSON answer as its own file. Keep the wording identical across rounds.

4. **Score** (the runner does this itself; by hand):

   ```
   npm run judge -- score key.json judge1.json judge2.json judge3.json
   ```

   It prints, per pair, how often `a` and `b` were picked, how many judges picked the same image in both orders,
   and how many did not separate the two (`cant_tell` in both orders, or the same side, so a different image, in
   each); the share of picks for `a` over real pairs; the share of left picks (position bias, 50% means none); and
   the share of judges who left each control unseparated, counted per judge. Malformed, missing or out-of-range
   answers (choices, and ratings when the panel asks for them) stop the score with a list of problems. Images keep
   only fully transparent pixels out; semi-transparent edges of a reference are drawn opaque.

Decide the pass rule (for example "a picked in at least 50% of picks, controls neutral in at least 2/3") in the plan
before running the panel, as for every other gate.

## Labelled panels

To ask which of several labels an image has (for example the direction a character faces), give the spec
`"kind": "choice"`, `labels` and `items` instead of `pairs`, each item
`{ "id": "knight-front", "image": "frames/knight-front.png", "label": "front" }`. `build` writes one image per item
and a key with the true labels; each judge answers `{ "choice": <label> }` or `cant_tell`; `score` prints, per label,
how many answers were right and what was named instead, and the share of correct answers over all of them
(`cant_tell` and missing answers count as wrong). An item with `"control": true` is a known case that is scored
apart (`score` prints the controls' accuracy and leaves them out of the share and the labels' counts).
`npm run direction-panel` builds the facing panel of the exported
idle frames of the four skinned humanoids into `reports/export-panel/`; `npm run behaviour-panel` builds the
action panel (idle, crouch and attack strips, with walk and jump strips as controls) into
`reports/behaviour-panel/`.
