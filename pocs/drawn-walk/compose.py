import math, json, sys
W, H, GROUND = 48, 54, 50
guide = open(sys.argv[1]).read().split('\n\n')[0].split('\n')[1:]
crop = [r[14:62] for r in guide[14:68]]
CAPE = set('Rrqc')
def upper_layer():
  px = {}
  for y in range(1, 17):
    for x, c in enumerate(crop[y]):
      if c != '.': px[(x, y)] = c
  for y, row in enumerate(TORSO):
    for x, c in enumerate(row):
      if c != '.': px[(18 + x, 17 + y)] = c
  return px
TORSO = [
  "..oommmmmdoo..",
  ".ohhsssssmmdo.",
  ".ohssssssssmdo",
  ".ohssssssssmdo",
  ".ohsssssssssmo",
  ".ohsssssssssmo",
  ".ohsssssssssmo",
  ".ohhssssssssmo",
  "..ohssssssmmdo",
  "..ohsssssmmddo",
  "..ohssssmmmdo.",
  "..oLlllllllLo.",
  "..oLLLLLLgGLo.",
  "..ommsssssmdo.",
  ".ohmssssssmmdo",
  ".ohmsssssmmmdo",
  "..oommmmmmmoo.",
]
PAULDRON = [
  "..oooo...",
  ".ohhssmo.",
  "ohhsssmdo",
  "ohssssmdo",
  ".ossmmdo.",
  "..oooo...",
]
UPPER = upper_layer()
HIP_Y0 = 33
def seg_pixels(a, b, w):
  out = set()
  (ax, ay), (bx, by) = a, b
  L = max(1e-6, math.hypot(bx - ax, by - ay))
  for y in range(H):
    for x in range(W):
      px, py = x + 0.5, y + 0.5
      t = max(0, min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (L * L)))
      cx, cy = ax + t * (bx - ax), ay + t * (by - ay)
      r = w[0] + (w[1] - w[0]) * t
      if math.hypot(px - cx, py - cy) <= r: out.add((x, y, ((px - cx) * (by - ay) - (py - cy) * (bx - ax)) / L / r))
  return out
def leg(hip, knee, ankle, heel, toe, near):
  tones = ('h', 's', 'm', 'd') if near else ('s', 'm', 'd', 'k')
  boot = ('t', 'l', 'L') if near else ('L', 'L', 'k')
  px = {}
  for (a, b, w) in ((hip, knee, (3.0, 2.6)), (knee, ankle, (2.6, 2.0))):
    for x, y, s in seg_pixels(a, b, w):
      tone = tones[0] if s < -0.55 else tones[1] if s < 0.1 else tones[2] if s < 0.6 else tones[3]
      px[(x, y)] = tone
  kx, ky = knee
  px[(round(kx - 0.5), round(ky - 0.5))] = tones[0]
  for x, y, s in seg_pixels(heel, toe, (1.7, 1.4)) | seg_pixels(ankle, heel, (1.8, 1.7)):
    px[(x, y)] = boot[0] if s < -0.5 else boot[1] if s < 0.5 else boot[2]
  return px
def cape(hip_y, sway, k, lift_hem=0):
  px = {}
  top = hip_y - 16
  bottom = hip_y + 9 - lift_hem
  for y in range(top, bottom):
    f = (y - top) / (bottom - top)
    right = 21 - round(f * 3)
    left = round(19 - f * (8 + 2.5 * sway) - 2 * math.sin(f * 4 + k * 0.8))
    for x in range(left, right + 1):
      band = (x + round(f * 4) + k) % 4
      px[(x, y)] = 'R' if band == 0 else 'r' if band in (1, 2) else 'q' if f < 0.25 and band == 3 else 'r'
  hem = hip_y + 9
  return px
def far_arm(hip_y, swing):
  sh = (23.5, hip_y - 11)
  elbow = (23 + swing * 0.6, hip_y - 5)
  hand = (25 + swing * 1.3, hip_y - 1)
  px = {}
  for a, b in ((sh, elbow), (elbow, hand)):
    for x, y, s in seg_pixels(a, b, (2.0, 1.7)):
      px[(x, y)] = 'm' if s < 0 else 'd'
  hx, hy = hand
  for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)): px[(round(hx) + dx - 1, round(hy) + dy)] = 'L'
  return px
def arm(hip_y, swing):
  sh = (25.5, hip_y - 11)
  elbow = (25 + swing * 0.6, hip_y - 5)
  hand = (29 + swing * 1.2, hip_y - 2 + abs(swing) * 0.25)
  px = {}
  for a, b in ((sh, elbow), (elbow, hand)):
    for x, y, s in seg_pixels(a, b, (2.2, 1.9)):
      px[(x, y)] = 'h' if s < -0.4 else 's' if s < 0.4 else 'm'
  for y, row in enumerate(PAULDRON):
    for x, c in enumerate(row):
      if c != '.': px[(22 + x, hip_y - 16 + y)] = c
  hx, hy = hand
  ang = math.radians(26 - swing * 5)
  blade = [(hx + 2 + i * math.cos(ang), hy + 2 + i * math.sin(ang)) for i in range(13)]
  for i, (x, y) in enumerate(blade):
    for d, c in ((-1, 'w'), (0, 'h'), (1, 'm')):
      px[(round(x), round(y) + d)] = c
  for d in range(-2, 3): px[(round(hx + 1), round(hy + 1) + d)] = 'g' if d < 1 else 'G'
  for (dx, dy) in ((-1, 0), (0, 0), (-1, -1), (0, -1), (0, 1), (-1, 1)): px[(round(hx) + dx, round(hy) + dy)] = 't' if dy < 0 else 'l'
  return px
def outline(layer_px, under):
  out = dict(under)
  edge = {}
  for (x, y) in layer_px:
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
      q = (x + dx, y + dy)
      if q not in layer_px and (q not in under or under[q] != 'o'): edge[q] = 'o'
  out.update(edge)
  out.update(layer_px)
  return out
def frame(p):
  bob = p['bob']
  hip_y = HIP_Y0 + bob
  canvas = {}
  canvas = outline(cape(hip_y, p['sway'], p['k'], p.get('hem', 0)), canvas)
  far = leg(*[(x, y) for x, y in p['far']], near=False)
  canvas = outline(far, canvas)
  canvas = outline(far_arm(hip_y, -p['swing']), canvas)
  squash = p.get('squash', 0)
  lean = p.get('lean', 0)
  up = {}
  for (x, y), c in UPPER.items():
    ny = y + bob + (squash if y < 24 else 0)
    if squash and y == 23: continue
    up[(x + (lean if y < 22 else 0), ny)] = c
  tail = {}
  lift = -bob
  for i, (dx, dy, c) in enumerate(((0, 0, 'R'), (-1, 0, 'R'), (-2, 1, 'r'), (-3, 1, 'r'), (-4, 2, 'R'), (-2, 0, 'R'), (-3, 2, 'c'))):
    tail[(18 + dx + p.get('lean', 0) + (p.get('flick', 0) if i >= 4 else 0), 4 + bob + p.get('squash', 0) + dy + (lift if i >= 2 else 0))] = c
  canvas = outline(tail, canvas)
  canvas.update(up)
  canvas = outline(leg(*[(x, y) for x, y in p['near']], near=True), canvas)
  canvas = outline(arm(hip_y, p['swing']), canvas)
  return [''.join(canvas.get((x, y), '.') for x in range(W)) for y in range(H)]
def L(hipdy, knee, ankle, heel, toe): return [(25, HIP_Y0 + hipdy), knee, ankle, heel, toe]
POSES = [
  dict(bob=0, sway=0, k=0, swing=-4, hem=0, lean=0, squash=0, flick=0, ball=33,
       near=L(0, (28, 41), (30.5, 47.5), (29.5, 49.5), (34.5, 46.5)),
       far=L(0, (22, 41.5), (18.5, 46.5), (17.5, 45.5), (22, 49.5))),
  dict(bob=1, sway=1, k=1, swing=-2, hem=-1, lean=1, squash=1, flick=1, ball=30,
       near=L(1, (28, 42), (27.5, 48), (25.5, 49.5), (31.5, 49.5)),
       far=L(1, (21.5, 42.5), (16.5, 46), (15.5, 44.5), (19, 48))),
  dict(bob=0, sway=3, k=2, swing=1, hem=1, lean=0, squash=0, flick=0, ball=27,
       near=L(0, (26, 41), (24.5, 48), (22.5, 49.5), (28.5, 49.5)),
       far=L(0, (25.5, 40), (22, 45), (21, 44), (25, 46.5))),
  dict(bob=-1, sway=2, k=3, swing=3, hem=2, lean=0, squash=0, flick=-1, ball=24,
       near=L(-1, (24, 40), (21, 46), (20, 45), (25, 49.5)),
       far=L(-1, (29, 38.5), (31.5, 45), (30.5, 45.5), (35, 44.5))),
]
POSES = POSES + [dict(p, near=p['far'], far=p['near'], swing=-p['swing'], k=p['k'] + 4) for p in POSES]
frames = [frame(p) for p in POSES]
def sole(legpose):
  heel, toe = legpose[3], legpose[4]
  return [round(toe[0] - 1.5), round(max(heel[1], toe[1]))]
meta = [dict(planted=0 if i < 4 else 1, soles=[sole(p['near']), sole(p['far'])]) for i, p in enumerate(POSES)]
xs = [x for f in frames for r in f for x, c in enumerate(r) if c != '.']
ys = [y for f in frames for y, r in enumerate(f) if r.strip('.')]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
frames = [[r[x0:x1 + 1] for r in f[y0:y1 + 1]] for f in frames]
for m in meta: m['soles'] = [[sx - x0, min(sy, y1) - y0] for sx, sy in m['soles']]
json.dump(frames, open(sys.argv[2], 'w'))
json.dump(meta, open(sys.argv[2].replace('.json', '-meta.json'), 'w'))

