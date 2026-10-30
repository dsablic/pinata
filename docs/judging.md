# Running a blind judge panel

How to ask blind AI judges whether one set of images beats another, with the safeguards the proofs settled on (see
[`docs/FINDINGS.md`](FINDINGS.md), "How it was tested"): neutral names, every pair in both orders, a control the judges must
not be able to separate, the answer key kept out of the judges' folder, and three fresh judges per question.

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

   `rating` asks for a 1-5 score for each side, which separates "both good" from "both bad"; it is optional, but the
   skins spike recommends always including it, and when present every answer must carry one. `scale` (default 8)
   and `gap` (default 2, in source pixels) set the layout; `background` defaults to `#c8c8c8`. Change `seed` for a
   new round to get a new order.

2. **Build the packet**, with the key outside it:

   ```
   npm run judge -- build panel.json packet/ key.json
   ```

   `packet/` gets `item-01.png`, ... (each pair twice, sides swapped, shuffled by the seed) and `questions.md`.
   Images are trimmed to their opaque area, stand on one baseline and keep their pixel sizes, scaled up together.

3. **Ask three fresh judges** (new agents with no other context), each given only the `packet/` folder and told to
   follow `questions.md`. Save each judge's JSON answer as its own file. Keep the wording identical across rounds.

4. **Score:**

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
