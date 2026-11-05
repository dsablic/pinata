# Proposal: ML Augmentation

Which models and tools could help Piñata turn any character art into game-worthy, eight-direction pixel animation,
and how to bring them in without making the tool depend on any of them.

## Recommendation in short

- **Piñata never depends on a model.** Every model output enters as a plain file in the character package (views,
  layers, points, takes, pixel art), with a provenance record. Optional providers produce those files when the user
  configures one; the agent itself is always the default provider. Export, `check`, `verify` and every gate read only
  stored files, so exports stay byte-reproducible.
- **Build the non-ML pieces first.** Grid recovery, pixelisation and the feel filter are small, well-published
  algorithms that fit in TypeScript with no dependency and no licence risk.
- **Try, in this order of value:** pixel-art normalisation (no model), new views (PixelLab rotate, CharacterGen or
  StdGEN), points (pose model plus pointing VLM), extra motion takes (100STYLE data, Uthana hosted text-to-motion),
  the feel filter (classic, no model), and layered decomposition for hidden areas (See-through).
- **Avoid** non-commercial or region-restricted models for anything that becomes a committed or shipped asset, and
  frame-generating video diffusion as a replacement for the motion engine.

## Extension point: inputs as files, providers as options

### File contracts

Each kind is a file format that `import` and the other commands accept, whoever made it: a person, the authoring
agent, a script, or a provider.

| Kind | File | Consumed by | Replaces |
|---|---|---|---|
| Normalised art | PNG, one pixel per art pixel, alpha background; `palette` in the manifest | `import` (skips normalisation) | the normalisation step |
| Views | one RGBA PNG per skin view: `front`, `frontSide`, `side`, `backSide`, `back` (`src/formats/skin.ts` `VIEWS`) | `import` (cut per view instead of drawing over the view guide) | the view guide as the only start for missing views |
| Layers | one RGBA PNG per layer, same canvas as the source, plus `layers.json`: name, draw order, and a mask of pixels that were synthesised rather than seen | `import` (cut from layers; synthesised pixels fill the hidden-area list) | the hidden-area list as the only fill |
| Points | `points.json`: name to `[x, y]` in source-image pixels, optional `confidence` | `import` (the existing image-and-points model) | points proposed by the agent |
| Takes | BVH, or ASF/AMC as today, plus a skeleton map like `motion/humanoid.json` and a `takes.json` entry | `npm run mocap -- convert` | only CMU capture |

### The manifest

A character package gains `inputs/` and `inputs/inputs.json`. Each entry records the file's SHA-256, its kind, and
its source: `agent`, `person`, or a provider with its name, model and version, the request parameters (prompt, seed),
the SHA-256 of every input it was given, and the output's licence or the terms of the service. `check` verifies the
hashes and reports any input whose file changed since it was recorded. A source of `agent` or `person` needs no more.

### Providers

- **Configuration.** Providers are listed in a user-level file (for example `~/.config/pinata/providers.json`), never
  in a character package or the repository. Each has either a `command` (an argv array, run with `spawn`, no shell)
  or an `http` endpoint with the name of an environment variable that holds its key. Node's built-in `fetch` covers
  HTTP, so no npm package is needed.
- **Protocol.** One request JSON on stdin (kind, input paths, parameters, an output directory), files written to the
  output directory, one result JSON on stdout. A wrapper for a Python model is the user's or a recipe's script; it
  runs out of process with its own environment.
- **One command.** `pinata provide <kind> <package> [--provider <name>]` is the only command that calls a model. It
  validates what comes back (PNG decoded and re-encoded by Piñata's own `src/png`, dimensions and size capped, JSON
  validated against the kind's schema, BVH parsed), writes the canonical bytes into `inputs/` and adds the manifest
  entry. The MCP server exposes `provide` only when a provider is configured; otherwise the agent fills the same
  files itself.
- **The agent is the baseline provider.** Every experiment below compares a provider against the authoring agent
  doing the same job with the existing guides; a provider earns its place only by beating that baseline.

### Determinism

Model output is not reproducible (GPU nondeterminism, hosted model updates), so it is generated once and stored as an
input file, like an artist's drawing. Exports depend only on stored inputs and stay byte-identical across runs;
`verify` never calls a provider. Regenerating is a deliberate act that writes a new input and a new manifest entry,
and the resulting output change is accepted with `npm run verify -- --accept <step>` like any meant change. Tests use
a fake provider (a TypeScript fixture that copies known files), never the network.

### Security

- No new npm packages; HTTP through `fetch`, processes through `node:child_process`.
- Models run out of process, in their own environment (a user's Python venv, a container, or a hosted API). Piñata
  never imports model code or downloads weights.
- Provider output is untrusted data: decoded by Piñata's own decoders, size-limited, re-encoded, never executed. A
  provider's environment gets only the variables it declares.
- API keys live in the environment, not in files Piñata writes; the manifest records no secret.

## Candidates by area

Marks: **P** checked on a primary source (repository licence file through the GitHub API, model card, arXiv abstract,
vendor pricing page or API specification); **S** from a secondary source, a search result or a reseller, and
unverified. Licences are the code's unless the weights are named. Nothing was run.

### 1. Part decomposition and hidden-area completion

| Candidate | What it does | Licence, weights | Compute or price | Maturity | Stylised input | Plugs in |
|---|---|---|---|---|---|---|
| See-through ([arXiv 2602.03749](https://arxiv.org/abs/2602.03749), [code](https://github.com/shitagaki-lab/see-through)) | One anime illustration to up to 23 inpainted semantic layers with draw order; trained on supervision from commercial Live2D models | Apache-2.0 (P); layer model OpenRAIL++ from SDXL, parser Apache-2.0, depth model's card unchecked (P) | 12-16 GB VRAM bf16, about 8 GB with NF4 (P); free HF Space, 1-2 runs a day; no paid API (P) | 5.4k stars, active (P) | Anime-native; pixel art would need upscaling, untested | Layers; synthesised masks fill the hidden-area list. Layers are hair, face, clothing, not limbs, so they need mapping to rig parts |
| Qwen-Image-Layered ([arXiv 2512.15603](https://arxiv.org/abs/2512.15603), [code](https://github.com/QwenLM/Qwen-Image-Layered)) | Any image to a variable number of RGBA layers | Apache-2.0 code and weights (P) | About 45 GB peak locally (S); [fal.ai](https://fal.ai/models/fal-ai/qwen-image-layered) $0.05 an image (P) | 2.2k stars (P) | Generic, splits by object and depth, not body part | Layers, as a fallback for non-anime art |
| Bunraku ([arXiv 2607.27348](https://arxiv.org/abs/2607.27348)) | Illustration to ordered RGBA layers with completion, meshes and keyposes for Live2D | Paper CC BY-NC-SA; repository has no licence, code or weights (P) | n/a | Paper only | Anime | Not usable until code and weights are released |
| CartoonAlive ([arXiv 2507.17327](https://arxiv.org/abs/2507.17327)) | Portrait to a Live2D face | No code (P) | n/a | Paper only | Faces only | None |
| Anime layer decomposition ([arXiv 2603.14925](https://arxiv.org/abs/2603.14925)) | Line art, flat colour, shadow and highlight layers | Code link returns 404 (P) | n/a | Paper only | Anime | Possibly palette and shading separation later |
| pix2gestalt ([arXiv 2401.14398](https://arxiv.org/abs/2401.14398), [code](https://github.com/cvlab-columbia/pix2gestalt)) | Amodal completion of an occluded object | CC BY-NC 4.0 (P) | GPU | Research | Trained on photos (S) | Excluded: non-commercial |
| SAM 2 ([code](https://github.com/facebookresearch/sam2)), SAM 3 ([arXiv 2511.16719](https://arxiv.org/abs/2511.16719)) | Promptable segmentation; SAM 3 takes concept prompts | SAM 2 Apache-2.0; SAM 3 own licence with export-control clauses, gated weights (P) | Small GPU or CPU for SAM 2 | Mature | Masks hold up on clean art (S) | Refining part boundaries; no completion |
| LaMa ([code](https://github.com/advimman/lama)) | Inpainting | Apache-2.0 (P) | CPU or small GPU | Mature, quiet since 2025 | Fine for small holes, weak on large ones | Small hidden areas |
| anime-segmentation ([code](https://github.com/SkyTNT/anime-segmentation)) | Foreground matte for anime | Apache-2.0 code and weights (P) | CPU | Maintained | Anime-native | Background removal for illustration input |
| FLUX.1 Fill [dev] | Inpainting | Non-commercial weights licence (P) | GPU | Mature | Good | Excluded |

Nothing found decomposes pixel art into body parts; at sprite sizes the deterministic cut along fitted bones stays
the method, and these models matter for illustrations.

### 2. New views from one image

| Candidate | What it does | Licence, weights | Compute or price | Maturity | Stylised input | Plugs in |
|---|---|---|---|---|---|---|
| PixelLab API v2 ([site](https://pixellab.ai/), [OpenAPI](https://api.pixellab.ai/v2/openapi.json)) | `rotate`, `generate-8-rotations-v3`, also `estimate-skeleton` and skeleton or text animation | Proprietary; commercial terms not found on reachable pages | About $0.011 a rotate at 128 px, $0.03-0.04 for eight rotations up to 256 px, 30-180 s a job (P, "estimates"); subscriptions $12-50 a month (S, conflicting) | Product | Pixel-art-native; south-facing input expected; non-humanoids untested | Views (five of its eight); its skeleton estimate as points |
| CharacterGen ([arXiv 2402.17214](https://arxiv.org/abs/2402.17214), [code](https://github.com/zjp-shadow/CharacterGen)) | Pose-canonicalising multi-view diffusion, then a 3D character | Apache-2.0 code and HF weights (P) | GPU, figure not stated; hosted only as a community Space (S) | 844 stars, quiet since 2025 (P) | Trained on VRoid anime characters | Views from its multi-view images or a render of its mesh |
| StdGEN ([arXiv 2411.05738](https://arxiv.org/abs/2411.05738), [code](https://github.com/hyz317/StdGEN)) | Anime image to a 3D model separated into body, clothes and hair, about 3 minutes | Apache-2.0 tag, but the README says checkpoints are "for research purposes only" (P): unresolved | GPU, `--low_vram` flag | 405 stars (P) | Anime-native (Anime3D++ from VRoid) | Views rendered from the mesh at the five yaws; layered parts |
| TRELLIS.2 ([code](https://github.com/microsoft/TRELLIS.2)) | Image to a textured mesh | MIT code and weights (P) | 24 GB VRAM or more; TRELLIS v1 on fal.ai $0.02 (P) | 12.7k stars (P) | Generic; stylised quality unverified, pixel art likely weak | Views rendered from the mesh |
| Hunyuan3D 2.x | Image to a textured mesh | Tencent community licence: not available in the EU, UK or South Korea (P) | fal.ai $0.16-0.48 (P) | Mature | Generic | Excluded: region restriction |
| Stable Fast 3D | Image to a mesh | Stability Community licence, revenue cap $1M (P) | Small GPU | Mature | Generic | Allowed under the cap; not preferred |
| InstantMesh, Zero123++, Wonder3D | Multi-view diffusion and reconstruction | Apache-2.0, Apache-2.0 (weights card silent), MIT (Wonder3D's plus weights AGPL) (P) | GPU | 2024-era | Generic | Second-tier views |
| Era3D, SV3D, GAS, PSHuman | Multi-view or human avatars | AGPL, non-commercial, CC BY-NC, MIT with CC BY weights (P) | GPU | Research | Era3D generic; GAS and PSHuman photoreal | Excluded or poor fit |
| Rotate Your Character ([arXiv 2601.05722](https://arxiv.org/abs/2601.05722)) | Pose-canonicalised orbit videos | No code or weights (P) | n/a | Paper only | Characters | None until released |
| Meshy, Tripo, Rodin | Hosted image-to-3D | Proprietary; Meshy's free output CC BY 4.0 (P) | Meshy 20-35 credits, Pro EUR 19 a month for 1,000 (P); Tripo about $0.15-0.35, Rodin $0.40-1.50 (S) | Products | Generic | Views from a rendered mesh |

The facing-readability diagnosis found the three-quarter views weakest (back-right 3 of 12 idle answers), so views
are where a provider could help most; a mesh render gives geometrically consistent three-quarter views, while
PixelLab gives pixel-native ones.

### 3. Points and rigs from art

| Candidate | What it does | Licence, weights | Compute or price | Maturity | Stylised input | Plugs in |
|---|---|---|---|---|---|---|
| The authoring agent (Claude) | Places named points when asked, the current path | n/a | Tokens | In use | Any style; accuracy at 32-64 px unmeasured | Baseline for every points experiment |
| DWPose ([code](https://github.com/IDEA-Research/DWPose)), RTMPose and RTMW in [MMPose](https://github.com/open-mmlab/mmpose) | Whole-body 2D keypoints | Apache-2.0 (P); ONNX weights | CPU through ONNX | Mature; DWPose quiet since 2023 (P) | MMPose trains on Human-Art (paintings, cartoons) (P); DWPose widely used on anime in ControlNet (S); pixel art needs upscaling | Humanoid joints |
| Gemini pointing, Molmo / Molmo 2 ([arXiv 2601.10611](https://arxiv.org/abs/2601.10611)) | VLM returns labelled points from a prompt | Gemini hosted; Molmo-7B-D Apache-2.0 "for research and educational use" on its card (P); Molmo 2 licence unchecked | Gemini per token; Molmo about 7B, local GPU | Gemini pointing documented in community notebooks (S) | Any style, any named point (tail tip, ear) | Free named points |
| Animated Drawings ([code](https://github.com/facebookresearch/AnimatedDrawings)) | Detects, segments and poses a drawn humanoid | MIT code, weights and dataset (P); archived | TorchServe in Docker | Archived 2025 (P) | Children's drawings | Humanoid joints on drawings |
| bizarre-pose-estimator ([arXiv 2108.01819](https://arxiv.org/abs/2108.01819), [code](https://github.com/ShuhongChen/bizarre-pose-estimator)) | Keypoints on anime illustrations | AGPL-3.0 (P) | GPU Docker | Research | Anime-specific | Out-of-process only, last resort |
| X-Pose ([arXiv 2310.08530](https://arxiv.org/abs/2310.08530)), CapeFormer ([code](https://github.com/flyinglynx/CapeFormer)) | Text-prompted or few-shot keypoints for any category | X-Pose licence unverified, UniKPT data non-commercial (P); CapeFormer Apache-2.0 (S) | GPU; old MMPose stack | Research | Unproven on art | Creature points, research trial |
| SuperAnimal (DeepLabCut) | Animal pose | Models research-only (P) | GPU | Mature | Real animals | Excluded |
| Sapiens | Human foundation models | CC BY-NC 4.0 (P) | GPU | Mature | Photos | Excluded |
| UniRig ([arXiv 2504.12451](https://arxiv.org/abs/2504.12451)), MagicArticulate, Puppeteer, RigNet | Skeleton and skinning for a 3D mesh | MIT; Apache-2.0; Apache-2.0; GPL-3.0 (P) | 8 GB or more; about 4.6 GB; n/a; n/a | Research | UniRig trained partly on VRoid | Only after an image-to-3D step, for a creature body |

Mesh auto-riggers do not apply to a single 2D image; they become relevant only if a creature is lifted to 3D.

### 4. Motion generation and augmentation

Piñata's library is 15 CMU clips (walks, a run, jumps, one idle, a squat, a punch). Generated takes enter through the
existing path: a take file converted by `npm run mocap -- convert`, retargeted, and either matched (locomotion) or
played on command (`kind` idle, crouch, attack). Today the converter reads ASF/AMC only; BVH needs a reader in
`src/mocap/` and a skeleton map per source skeleton.

| Candidate | What it does | Licence, weights, data | Compute or price | Maturity | Game moves | Plugs in |
|---|---|---|---|---|---|---|
| 100STYLE ([site](https://www.ianxmason.com/100style/)) | 100 locomotion styles, 4M frames, BVH | CC BY 4.0, commercial use with credit (P) | Data | Published dataset | Walk, run, sidestep, idle in styles; no attacks | Takes: styled locomotion for matching |
| Uthana ([pricing](https://uthana.com/pricing)) | Hosted text-to-motion, video-to-motion, looping | Commercial use of outputs under its terms (P) | Text-to-motion $0.02-0.10 a second, video $0.05 a second (P) | Product | Attacks, emotes from a prompt | Takes; export format to confirm |
| Kimodo ([arXiv 2603.15546](https://arxiv.org/abs/2603.15546), [code](https://github.com/nv-tlabs/kimodo)) | Text-to-motion with keyframe and path controls | Apache-2.0 code (P); SOMA weights under the NVIDIA Open Model License (terms not read), SMPL-X variant non-commercial (P) | About 17 GB VRAM, under 3 GB with the text encoder on CPU (P) | 4k stars, active (P) | General moves | Takes; NPZ output needs a SOMA skeleton map |
| MoMask ([code](https://github.com/EricGuo5513/momask-codes)), MDM ([code](https://github.com/GuyTevet/motion-diffusion-model)) | Text-to-motion; MoMask writes BVH | MIT code; weights trained on HumanML3D, derived from AMASS, whose licence bars commercial use of trained models (P) | Small GPU | Mature research | General | Research measurement only |
| HY-Motion 1.0 ([code](https://github.com/Tencent-Hunyuan/HY-Motion-1.0)) | 1B-parameter text-to-motion | Excludes the EU, UK and South Korea; outputs may not train other models (P) | 24-26 GB VRAM (P) | New | General | Excluded |
| MotionLCM, GVHMR, Sapiens-based capture | Text-to-motion; video-to-motion | Non-commercial (P) | GPU | Research | | Excluded |
| WHAM ([code](https://github.com/yohanshin/WHAM)) | Video to SMPL motion | MIT code, but SMPL's body model is non-commercial (P) | GPU | Research | Anything filmable | Excluded unless SMPL is licensed; a hosted service avoids it |
| LAFAN1, Bandai Namco datasets | BVH capture including fights | CC BY-NC-ND 4.0; CC BY-NC 4.0 (P) | Data | Published | Fighting | Excluded from committed takes |
| ProtoMotions, MaskedMimic ([code](https://github.com/NVlabs/ProtoMotions)) | Physics-based controllers | Apache-2.0 code, NVIDIA model licence (P); AMASS training | Isaac Lab, large GPU | Research | | Not yet: a simulator stack, not a take source |
| DeepMotion, Move.ai, Plask | Hosted video-to-motion | Proprietary | About $15-250 a month (S) | Products | Filmable moves | Takes |

No commercially usable creature motion source was found (dog datasets are unreleased or CC BY-NC); creatures keep
the procedural gait and biped retargeting.

### 5. Animation feel

No learned "toon-ification of mocap" with released code was found. The best available are classic and small.

| Method | What it does | Code | In TypeScript |
|---|---|---|---|
| [Cartoon Animation Filter](https://grail.cs.washington.edu/wp-content/uploads/2015/08/wang-2006-tca.pdf) (Wang et al., SIGGRAPH 2006) | Subtracts a smoothed second derivative from each channel: anticipation, follow-through, exaggeration in one filter | None found | About 20 lines per channel; rotations need quaternion care |
| [Kwon and Lee 2008](https://diglib.eg.org/items/ef7405d6-5012-422a-a0af-6ee2f5cf8bfa), sub-joint exaggeration | Exaggerated trajectories and rubber-hose stretch via sub-links and a mass-spring | None found | Moderate; stretch needs part sprites that scale along the bone |
| [Chenney et al. 2002](https://dx.doi.org/10.1145/508530.508553) | Volume-preserving squash and stretch from velocity and contact | None found | Easy, per part: scale s along velocity, 1/s across |
| SMEAR ([code](https://github.com/MoStyle/SMEAR), SIGGRAPH 2024) | Smear frames: elongated and multiple in-betweens, motion lines | GPL-3.0 Blender add-on (S) | Reimplement the idea only |
| SMooDi ([arXiv 2407.12783](https://arxiv.org/abs/2407.12783)) | Motion diffusion with a style clip | Not confirmed | Not portable; human styles, not cartoon |
| Holds and on twos | Stepped timing at pose extremes | No paper found; studio practice | Heuristic: holds at velocity minima and curvature peaks of the pose path, 12 fps stepping |

### 6. Pixelisation

| Tool | Method | Licence | Fit |
|---|---|---|---|
| [unfake.js](https://github.com/jenissimo/unfake.js) | Grid scale by run-length GCD and edges, Wu quantisation, per-cell mode, background flood fill | MIT (P) | Best reference for a TypeScript port of grid recovery |
| [Sprite Fusion Pixel Snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper) | Snaps AI pixel art to a grid and palette | MIT, Rust with WASM (P) | Reference implementation to compare against |
| [proper-pixel-art](https://github.com/KennethJAllen/proper-pixel-art), perfectPixel | Hough or FFT grid detection | MIT (P for the first) | Alternative grid detectors, Python |
| [Pixelated Image Abstraction](https://cragl.cs.gmu.edu/pixelate/) (Gerstner et al. 2012) | SLIC-style superpixels to output pixels, palette by annealing in CIELAB | Source licence unknown | Best published method for illustrations with no grid; reimplement from the paper |
| [Pyxelate](https://github.com/sedthh/pyxelate) | Edge-oriented sampling, Bayesian GMM palette, dithering | MIT (S) | Dithering ideas |
| [Make Your Own Sprites](https://github.com/WuZongWei6/Pixelization) (SIGGRAPH Asia 2022) | Learned, cell-controllable pixelisation | Non-commercial (P) | Excluded |
| Retro Diffusion, pixel-art LoRAs | Generators | Proprietary; FLUX [dev] LoRAs non-commercial, some FLUX.2-klein LoRAs Apache-2.0 (S) | Generate art, still need grid snapping |

Grid recovery handles upscaled sprites and image-model "pixel art"; illustrations have no grid and need the
superpixel route, an outline pass and a palette budget. All of it fits in TypeScript in `import`'s normalisation.

### 7. Frame-generating competitors

| Candidate | What it does | Licence, price | Strengths | Weaknesses |
|---|---|---|---|---|
| Sprite Sheet Diffusion ([arXiv 2412.03685](https://arxiv.org/abs/2412.03685), [code](https://github.com/chenganhsieh/Sprite-Sheet-Diffusion)) | Animate Anyone adapted to sprites: reference image plus a pose sequence to frames | MIT stated in the README, no licence file (P); base models SD 1.5 (OpenRAIL-M) and Moore-AnimateAnyone; weights on Google Drive | Pose-conditioned, so Piñata's projected rig could drive it | 45 stars, research-grade; video diffusion keeps no pixel grid or fixed palette (S) |
| PixelLab | Skeleton and text animation, rotations, Aseprite plugin, API | Proprietary; see area 2 | Pixel-native, eight directions, cheap | Per-frame identity and palette drift reported (S) |
| Retro Diffusion `rd-animation` ([Replicate](https://replicate.com/retro-diffusion)) | Walk and idle sheets from a prompt | Proprietary; Aseprite extension $65 (S) | Pixel-native | Reference image not used as the start frame (P); no rotation |
| ToonCrafter ([code](https://github.com/ToonCrafter/ToonCrafter)) | Cartoon in-betweening | Apache-2.0 vs OpenRAIL-M in its card, inconsistent (S) | Smooth cartoon motion | 512x320 video, not pixel art |
| Ludo.ai, AutoSprite, Scenario, Sprite-AI | Sprite generators, some animated | $15-300 a month (S); AutoSprite claims eight directions and an MCP server (marketing) | Speed | No independent tests found |

What they share, according to write-ups rather than measurement (S): bounding boxes and baselines that wander, palette
drift, costume details that change between directions, a pop at the loop seam, background bleed. Piñata's strengths
are the opposite: a fixed grid and palette, consistent directions, planted feet, physics-driven cloth. No independent
quantitative comparison of these products was found, which the benchmark can supply.

**Measures to run on any sheet, ours or theirs** (all computable in `src/benchmark` with no judge): palette drift
(colours outside the first frame's palette, OKLab ΔE above a threshold), off-grid pixels (the detected cell size
against 1), bounding-box and baseline jitter, loop seam (last-to-first change against the median neighbouring
change), foot slide on drawn pixels, temporal flicker, and identity across directions (per-part colour histograms).
Direction readability uses the existing blind direction panel.

## Shortlist

Ranked by expected value for the open plans against cost and licence risk. Each experiment compares against a
baseline without the model, and its gates are fixed here before it runs; adopting a provider needs every gate.

### 1. Normalisation and pixelisation in TypeScript (no model)

Part of import batch A, which already gates it.

- **Experiment.** Grid recovery after unfake.js (run-length GCD plus edge alignment, per-cell mode, Wu or OKLab
  k-means palette) and a superpixel pixeliser after Gerstner et al. with an outline pass. Pixel Snapper runs out of
  process as a reference, not a dependency. Inputs: 20 CC0 sprites, each upscaled 2-6x with blur, JPEG noise, palette
  noise and a background; 4 CC0 illustrations.
- **Gates.**
  - The grid scale is found exactly on at least 19 of 20 degraded sprites.
  - The original is recovered within 1% of its pixels on at least 18 of 20 (the import plan's gate, per input).
  - The illustration choice panel of the import plan: at least 90%.
  - Both are at least as good as Pixel Snapper on the same 20 inputs.
  - Control: an undegraded sprite passes through unchanged, byte for byte.
- **Cost.** Engineering only; one choice panel, about $1-2 at the facing panel's rate ($0.61 for 192 answers).

### 2. New views: PixelLab rotations and CharacterGen against view guides

The largest gap: three-quarter views read worst, and one-view import asks the agent to invent four views.

- **Experiment.** Six inputs: the front standing frame of four LPC characters (their own side and back frames are
  ground truth) and two CC0 illustrations. Three arms, each finished by a fresh agent with the guide:
  - A, control: the agent draws over `import`'s view guides.
  - B: PixelLab `generate-8-rotations-v3` output stored as views, then cleaned by the agent.
  - C: CharacterGen multi-view output, pixelised by experiment 1, then cleaned by the agent.

  StdGEN replaces C only if its weights' "research purposes only" note is resolved.
- **Gates.**
  - Each arm is held to the facing-readability gates on its six characters: idle 90%, each direction 2 of 3, walk 80%.
  - Identity: a blind choice panel matches each generated back and three-quarter view to its character among four
    in at least 90% of answers.
  - Preference: B or C is preferred or tied against A in at least 60% of a blind pairwise panel on the eight-direction
    idle sheets, both orders.
  - Controls: an arm against itself, and the LPC ground truth against itself.
  - Effort: B or C needs no more `check` runs than A.
- **Cost.** PixelLab about $0.04 a run, so under $2 for six characters at three tries each. CharacterGen on a rented
  24 GB GPU for a few hours; on-demand rates around $1-3 an hour (S). Panels about $3-5.

### 3. Points: a pose model and a pointing VLM against the agent

- **Experiment.** Ground truth for free: the four humanoid examples rendered at rest in five views give exact
  projected joints; add the four LPC characters hand-labelled once. Arms:
  - A, control: the authoring agent places the points.
  - B: DWPose via ONNX on a 4x nearest-neighbour upscale.
  - C: Gemini pointing.
  - D: B for humanoid joints, plus C for free points.
- **Gates.**
  - Median error at most 1.5 art pixels on a 48 px character, with at most 5% of points beyond 4 px.
  - With uncorrected points, the import round trip (at most 2% of opaque pixels differ) passes on at least 8 of 10
    character-views.
  - The arm beats A on both numbers.
  - Control: points jittered by 3 px must fail the round-trip gate, which shows the gate can see point error.
- **Cost.** DWPose on CPU, free. Gemini under $1. A half-day of labelling.

### 4. Takes: 100STYLE and hosted text-to-motion

Fills the library's gaps (one punch, one idle) for the behaviour library and the benchmark's attack and idle pairs.

- **Experiment.** A BVH reader and a skeleton map, then:
  - from 100STYLE, six styled walks and idles;
  - from Uthana, three attacks (slash, thrust, overhead) and two emotes (wave, cheer), each prompt run three times
    with the best stored.

  Kimodo is a third arm only after the NVIDIA Open Model License is read and found to allow it.
- **Gates.**
  - After retargeting to the four humanoids: foot slide on planted frames and ground penetration no worse than the
    CMU takes' current values on the same characters, and no new findings in the glitch survey.
  - A blind choice panel names each attack and emote among its five prompts in at least 90% of answers.
  - The benchmark rubric rates the generated attack at least equal to `attack-punch` on readability and weight in at
    least 50% of answers, both orders, with a take-against-itself control within 0.5.
  - Existing outputs stay byte-identical: new takes add clips and leave matching unchanged unless accepted.
- **Cost.** 100STYLE free, with credit recorded in `motion/README.md`. Uthana about 5 takes, 4 s each, 3 tries, at
  $0.10 a second: about $6. A few days for the BVH reader and the map.

### 5. The feel filter (classic, no model)

- **Experiment.** The Cartoon Animation Filter on the retargeted joint rotations and root path, holds at pose
  extremes with optional 12 fps stepping, and per-part velocity squash, each a per-character setting that is off by
  default. Run it on the benchmark's idle, walk, jump and attack pairs.
- **Gates.**
  - On the benchmark rubric, the filtered animation is rated above the unfiltered one on anticipation and weight in
    at least 70% of answers.
  - Fluidity falls by no more than 0.3 on average.
  - A control that must fail: the filter at three times its chosen strength is rated below the unfiltered animation
    on appeal.
  - The feet-held and flicker gates still pass, and outputs are byte-identical with the setting off.
- **Cost.** Engineering; panels about $3-5.

### 6. See-through for hidden areas on illustrations

- **Experiment.** Four CC0 anime-style illustrations and two upscaled sprites. Arm A, the control: the agent fills the
  hidden-area list. Arm B: See-through's layers mapped to rig parts, with synthesised pixels taken as the fill and
  then cleaned by the agent.
- **Gates.**
  - No hidden-area pixel is left unfilled in either arm.
  - On walk and turn frames that expose hidden areas, B is preferred or tied against A in at least 60% of a blind
    pairwise panel, both orders, with an A-against-A control.
  - B needs no more `check` runs than A.
  - Expected result on the two sprites: B fails. This is reported, not gated, and shows where the model stops.
- **Cost.** A free HF Space is too limited for six runs; a rented 16 GB GPU for a few hours (S rates as above).
  Panels about $3.

## Constraints

- **Licences.** Adopted providers must be MIT, Apache-2.0, BSD or CC BY in their code, weights and training-data terms,
  or a hosted service whose terms grant commercial use of outputs. OpenRAIL-style weights (SDXL, See-through's layer
  model) are acceptable with their use restrictions noted. Excluded from anything stored as an input or committed:
  non-commercial (pix2gestalt, GAS, SV3D, Sapiens, Pixelization, FLUX [dev] Fill, MotionLCM, GVHMR, SuperAnimal,
  LAFAN1, the Bandai Namco sets, the SMPL body model), region-restricted (Hunyuan3D and HY-Motion: not in the EU, UK
  or South Korea), copyleft for linked code (Era3D, RigNet, bizarre-pose-estimator; usable only out of process), and
  AMASS-trained weights (MDM, MoMask), whose outputs' commercial status is unclear. CMU takes may not be resold, as
  today; generated takes carry their own terms in `takes.json`.
- **No local GPU.** Each shortlisted job has a GPU-free path: PixelLab, Uthana, Gemini, fal.ai (TRELLIS,
  Qwen-Image-Layered) are hosted; DWPose runs on CPU; experiments 1 and 5 need nothing. See-through and CharacterGen
  have no paid API, so they need a rented GPU or a free Space.
- **Determinism.** Generated once, stored as an input, hashed in the manifest; exports and `verify` never call a
  provider; regenerating is a named, accepted output change.
- **Security.** No npm packages; models out of process; outputs decoded, re-encoded and size-capped; keys from the
  environment only.

## Risks and what not to do

- **Do not generate frames.** Video diffusion (Sprite Sheet Diffusion, ToonCrafter, Wan Animate) would replace the
  motion engine with a model that keeps no grid, palette, contact or direction consistency. Piñata's value is the
  opposite. Measure these tools; do not build on them.
- **Do not let a provider into the export path.** No model call in `export`, `check`, `verify` or the runtime.
- **Vendor drift.** Hosted models change without notice; stored inputs protect exports, but experiments must record
  the model version and date of each run in the results.
- **Judge bias.** Diffusion output is smooth and detailed, and judges may prefer it at scale 8 while it fails at
  48 px. Panels show the frames at game size as well, and the measured numbers (off-grid pixels, palette drift) sit
  beside every preference.
- **Licence ambiguity.** StdGEN (tag against README), ToonCrafter (two licences), Sprite Sheet Diffusion (no licence
  file), See-through's depth model (no card checked), Molmo ("research and educational"), PixelLab (no terms found).
  Each is resolved in writing before any output is stored.
- **Anime is not pixel art.** Most decomposition and view models train on VRoid or Live2D anime; on 32-64 px sprites
  they need upscaling and may fail. Experiments include sprites on purpose.
- **Cost creep.** Each experiment states its budget; a provider that needs more than three tries per character to
  pass its gates is not adopted.
- **Agent dependence.** The agent remains the default for every kind, so a user with no provider loses nothing.

## Suggested order

1. **Facing readability** (current): no model. The direction panel and checks it builds become the views gate.
2. **Animation benchmark:** add the competitor measures above, and run them on a few PixelLab and Retro Diffusion
   animation sheets as extra measured items, not gated. Cost: a few dollars.
3. **Import:**
   - Batch A: the file contracts, the manifest and `pinata provide` with a fake provider. Experiment 1 inside
     normalisation, then experiment 3 for points.
   - Batch B: experiment 2 for views, experiment 6 for hidden areas.
   - Batch C as planned, with whichever providers passed.
4. **Feel layer:** experiment 5, aimed at the benchmark's weakest dimensions.
5. **Takes:** experiment 4, once the benchmark has named attack and idle as weak or the behaviour library needs more
   attacks. It is independent of import and can run beside it.

A plan in `docs/plans/` per experiment, with the gates above copied in unchanged and only tightened, comes before any
code.
