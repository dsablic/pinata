import json, sys
src, out = sys.argv[1], sys.argv[2]
DARK = dict(o='o', k='o', d='k', m='d', s='m', h='s', w='h', l='L', t='l', L='k', q='r', r='R', R='c', c='c', g='G', G='L')
def darker(rows): return [''.join(DARK.get(ch, ch) for ch in r) for r in rows]
P = {}
P['helmet'] = ([
  "......mmsssh.....",
  "....dmmssshhhh...",
  "...dmmsssshhwwh..",
  "..kdmmssssshwwhh.",
  ".kdmmmssssssshhhs",
  ".kdmmmsssssssshss",
  "kddmmmsssssssskdd",
  "kddmmmssssssskooo",
  "kddmmmmssssssmmmm",
  "kddmmmmsssssssshs",
  "kkddmmmssssssssss",
  ".kddmmmmsssskssks",
  ".kddmmmmsssssssss",
  ".kkddmmmmmssssss.",
  "..kkddmmmmmmmmm..",
  "..kkkdddmmmmmd...",
  "...kkkkdddddd....",
], dict(pivotA=[8, 7]))
P['plume'] = ([
  "..........RRcc",
  "RRrrrrrrrrrRRc",
  "rqqqqrrrrrrRc.",
  "qqqqqqrrrrR...",
  ".qqqqqrr......",
  "..qqqr........",
], dict(pivotA=[2, 1], pivotB=[11, 1]))
P['torso'] = ([
  "lLkkddddddk.",
  "lLkdddddddkk",
  "lLddmmmmmmdd",
  "lLdmmmmmmmmd",
  "lLmmmsssssmm",
  "lLmssssssshs",
  "gGsssssrhhws",
  "gGsssrqqrhws",
  "gGssssrrshhs",
  "gGmssssshhhm",
  "kLmmssssshm.",
], dict(pivotA=[1, 5], pivotB=[11, 5]))
P['hips'] = ([
  ".kddLl",
  "kddmLl",
  "dmmmLl",
  "mmssLl",
  "msssLl",
  "msshGg",
  "sshwGg",
  ".shhLL",
], dict(pivotA=[1, 4], pivotB=[5, 4]))
P['capeR'] = ([
  "..qqqqqqqqqrrrrrrrrrrrrrR",
  ".qrrrrrrrrrrrrrrrrrrrrrrR",
  "qrrrrrrrrrrrrrrrrrrrrrrRR",
  "rrrrrRRRRRRRRRRRRRRRRRRRc",
  "RRRRRRRRRRRRRRRRRRRRRRRRc",
  ".RRRRRRccccccccRRRRRRRccc",
  "..ccccccccccccccccccccccc",
], dict(pivotA=[1, 3], pivotB=[24, 3]))
P['thighR'] = ([
  "..kddddddddd...",
  ".kdmmmmmmmmmdd.",
  "dmmmmmmmmmmmmmd",
  "mssssssssssssss",
  "msshhhhhhhwwhhs",
  ".shhhhhhhhhhhs.",
  "..ssssssssss...",
], dict(pivotA=[3, 3], pivotB=[12, 3]))
P['shinR'] = ([
  ".mmd.kdddddd..",
  "mshhdddmmmmmd.",
  "shwwhdmmmmmmmm",
  "shwhsdssssssss",
  "msshdshhhhhwhs",
  ".mmm..sssss...",
], dict(pivotA=[2, 3], pivotB=[11, 3]))
P['footR'] = ([
  ".lltttl..",
  "Llllttttl",
  "LLllllltt",
  "LLLLlllll",
  "kLLLLLLL.",
], dict(pivotA=[2, 2], pivotB=[6, 2]))
P['pauldronR'] = ([
  "....shhh..",
  "..msshwwh.",
  ".mmssshhhs",
  "mmmsssssss",
  "dmmmssssss",
  "kddmmmmmmd",
  ".kkddddkk.",
], dict(pivotA=[5, 3]))
P['upperArmR'] = ([
  "..kkdddddd..",
  ".kddmmmmmmd.",
  "dmmmmmmmmmmm",
  "msssssssssss",
  ".shhhhhhhhs.",
  "..ssssssss..",
], dict(pivotA=[3, 3], pivotB=[9, 3]))
P['forearmR'] = ([
  ".kddddddd.",
  "dmmmmmmmmd",
  "msssssssss",
  "shhhhwhhhs",
  ".ssssssss.",
], dict(pivotA=[2, 2], pivotB=[8, 2]))
s = json.load(open(src))
parts = s['views']['side']['parts']
for name, (rows, piv) in P.items():
  w = len(rows[0])
  assert all(len(r) == w for r in rows), name
  parts[name] = {**piv, 'rows': rows}
for near, far in [('capeR', 'capeL'), ('thighR', 'thighL'), ('shinR', 'shinL'), ('footR', 'footL'), ('pauldronR', 'pauldronL')]:
  parts[far] = {**{k: v for k, v in parts[near].items() if k != 'rows'}, 'rows': darker(parts[near]['rows'])}
for a in ['upperArm', 'forearm']:
  parts[a + 'L'] = json.loads(json.dumps(parts[a + 'R']))

Q = {}
Q['frontSide'] = {
 'helmet': ([
  "......mmssshh....",
  "....dmmsssshhhh..",
  "...dmmssssshhwwh.",
  "..kdmmsssssshwwhh",
  ".kdmmmsssssssshhs",
  ".kdmmmssssssssshs",
  "kddmmmmsssssssssh",
  "kddmmkooooooooooo",
  "kddmmmkddddddddmm",
  "kddmmmmsssssssshs",
  "kkddmmmssksskssss",
  "kkddmmmmsssssssss",
  ".kddmmmmmssssssss",
  ".kkddmmmmmsssssm.",
  "..kkddmmmmmmmmm..",
  "..kkkdddmmmmmd...",
  "...kkkkdddddd....",
 ], dict(pivotA=[8, 7])),
 'plume': ([
  "........RRcc",
  "RRrrrrrrrRRc",
  "rqqqqrrrrRc.",
  "qqqqqrrrR...",
  ".qqqqr......",
  "..qq........",
 ], dict(pivotA=[2, 1], pivotB=[9, 1])),
 'torso': ([
  "Llkdddddddd.",
  "Llddmmmmmmdd",
  "Lldmmmmmmmmd",
  "Lldmmmmmmmmm",
  "Llmmmmssssmm",
  "Llmmsssssssm",
  "Llmssssssssm",
  "Llmsssssssss",
  "Llssssssssss",
  "ggssssssrshs",
  "Ggssssrrrrhw",
  "GGssssrrrrhw",
  "Llssssssrshs",
  "Llssssssshhs",
  "Llmsssssshhm",
  "kLdmmmmmmmmm",
 ], dict(pivotA=[1, 8], pivotB=[11, 8])),
 'hips': ([
  ".kddLl",
  "kddmLl",
  "kdmmLl",
  "dmmmLl",
  "dmmsLl",
  "mmssLl",
  "mmssGg",
  "msshGg",
  "msshGg",
  "msshLl",
  "sshhLl",
  "sshwLl",
  "shhwLL",
  "sshhLL",
  ".sshLL",
 ], dict(pivotA=[1, 7], pivotB=[5, 7])),
}
back = {k: (list(v[0]), dict(v[1])) for k, v in Q['frontSide'].items()}
back['helmet'][0][7] = "kddmmmmsssssssshs"
back['helmet'][0][8] = "kddmmmddddddddmmd"
back['helmet'][0][10] = "kkddmmmssssssssss"
back['torso'] = ([
  "Llkdddddddd.",
  "Llddmmmmmmdd",
  "Lldmmmmmmmmd",
  "Lldmmmmmmmmm",
  "Llmmmmssssmm",
  "Llmmsssssssm",
  "Llmsssssssss",
  "Llmsssssssss",
  "Llssssmsssss",
  "Llssssmsssss",
  "Llsssssssshs",
  "Llssssssshhw",
  "Llssssssshhs",
  "Llmsssssshhs",
  "kLmmssssssmm",
  "kLdmmmmmmmm.",
 ], dict(pivotA=[1, 8], pivotB=[11, 8]))
back['hips'] = ([r.replace('G', 'L').replace('g', 'l') for r in back['hips'][0]], back['hips'][1])
back['plume'] = (P['plume'][0], dict(P['plume'][1]))
Q['backSide'] = back
SHARED = ['thighR', 'thighL', 'shinR', 'shinL', 'pauldronR', 'pauldronL', 'upperArmR', 'upperArmL', 'forearmR', 'forearmL']
for view, own in Q.items():
  vp = s['views'][view]['parts']
  for name, (rows, piv) in own.items():
    w = len(rows[0])
    assert all(len(r) == w for r in rows), (view, name)
    vp[name] = {**piv, 'rows': rows}
  for name in SHARED: vp[name] = json.loads(json.dumps(parts[name]))
  if view == 'frontSide':
    for name in ['capeR', 'capeL', 'footR', 'footL']: vp[name] = json.loads(json.dumps(parts[name]))
json.dump(s, open(out, 'w'), indent=2)
