import { declareGate } from '../src/checks/gate-spec.ts'
import type { Verdict } from '../src/checks/gate-spec.ts'
import {
  backFaceFindings, BACK_SLIVER, PROFILE_MIN, profileFindings, THREE_QUARTER_MIN, threeQuarterFindings
} from '../src/export/direction-cues.ts'
import type { Measurement, Regions } from '../src/export/direction-cues.ts'
import type { Skin, ViewName } from '../src/formats/skin.ts'
import {
  DISTINCT, FACE_ONLY, HEAD, headSkin, mirroredRows, pivoted, recoloured, skinOf, TORSO_ONLY
} from './direction-fixtures.ts'
import type { Views } from './direction-fixtures.ts'

const NO_PARTS: Regions = { face: [], features: [], torso: [] }

const verdict = ({ findings, reason }: Measurement): Verdict => {
  return { pass: reason === undefined && findings.length === 0, measured: reason === undefined }
}
const threeQuarter = (views: Views, regions: Regions = FACE_ONLY): Verdict => {
  return verdict(threeQuarterFindings(headSkin(views), regions))
}
const backFace = (views: Views): Verdict => verdict(backFaceFindings(headSkin(views), FACE_ONLY))
const profile = (rows: string[]): Verdict => verdict(profileFindings(headSkin({ side: { head: rows } }), FACE_ONLY))
const profilePivot = (rows: string[], pivot: [number, number]): Verdict => {
  return verdict(profileFindings(pivoted(headSkin({ side: { head: rows } }), 'side', 'head', pivot), FACE_ONLY))
}

const SIDE_FACE = ['.hhhhh.', 'hhhhsss', 'hhhhsee', 'hhhhsss', '.hhhhh.']
const nearFront = (changed: number): Views => ({
  frontSide: { head: recoloured(HEAD, 's', 'n', changed) }, backSide: { head: recoloured(HEAD, 'h', 'n', 12) }
})
const HAIR = ['.hhhhh.', 'hhhhhhh', 'hhhhhhh', 'hhhhhhh', '.hhhhh.']
const backWithFace = (pixels: number): Views => ({
  front: { head: HEAD },
  side: { head: SIDE_FACE },
  back: { head: recoloured(HAIR, 'h', 's', pixels) },
  backSide: { head: HAIR }
})
const PADDED = HEAD.map(row => `${row}.`)
const EVEN = ['.hhhh.', 'hhhhhh', 'hseesh', 'hssssh', '.hhhh.']
const WORN: Regions = { face: ['head', 'scarf'], features: ['head'], torso: [] }
const FRONT_INSET = ['.hhhhh.', 'hhhhhhh', 'hsesesh', 'hmmmmmh', '.hhhhh.']
const wornSkin = (backScarf: string[]): Verdict => verdict(backFaceFindings(skinOf({
  front: { head: FRONT_INSET, scarf: ['mmmm', 'mmmm'] },
  frontSide: { head: DISTINCT, scarf: ['mmmm', 'mmmm'] },
  side: { head: SIDE_FACE, scarf: ['mmmm', 'mmmm'] },
  backSide: { head: HAIR, scarf: backScarf },
  back: { head: HAIR, scarf: backScarf }
}), WORN))
const noseOf = (height: number): string[] => {
  return HEAD.map((row, y) => y >= 2 && y < 2 + height ? `${row.slice(0, 6)}n` : row)
}
const withoutPivot = (skin: Skin, view: ViewName): Skin => {
  const copy = structuredClone(skin)
  delete copy.views![view].parts.head.pivotA
  return copy
}
const torsoSkin = (backSide: string[]): Verdict => verdict(threeQuarterFindings(skinOf({
  front: { torso: ['mmmm', 'mmmm'] }, frontSide: { torso: ['bbbbbb', 'bbbbbb'] }, side: { torso: ['mm', 'bb'] },
  backSide: { torso: backSide }, back: { torso: ['bbbb', 'bbbb'] }
}), TORSO_ONLY))

declareGate({
  gate: 'threeQuarterViews',
  observes: 'files',
  frame: 'the skin sprites of the head parts (parts whose joints all lie above the shoulders) and of the torso ' +
    'parts, of frontSide against front and side, and of backSide against back and side, each also against the ' +
    'neighbour mirrored, aligned on pivotA and compared pixel by pixel in colour',
  threshold: `the pixels differing, summed over a region's parts and taken as the smaller of the neighbour and its ` +
    `mirror, number at least ${THREE_QUARTER_MIN}: two features two pixels tall each moved one column`,
  bad: [
    { name: 'a frontSide head identical to the front head', run: () => threeQuarter(nearFront(0)) },
    {
      name: 'a frontSide head that is the side head mirrored',
      run: () => threeQuarter({ frontSide: { head: mirroredRows(SIDE_FACE) }, side: { head: SIDE_FACE } })
    },
    {
      name: 'a frontSide head one pixel short of the minimum from the front head',
      run: () => threeQuarter(nearFront(THREE_QUARTER_MIN - 1))
    },
    { name: 'a backSide head identical to the back head', run: () => threeQuarter({ backSide: { head: HEAD } }) },
    { name: 'a backSide torso identical to the back torso', run: () => torsoSkin(['bbbb', 'bbbb']) },
    { name: 'a frontSide head with no sprite', run: () => threeQuarter({ frontSide: {} }) },
    {
      name: 'a side head with no sprite, which both three-quarter views compare against',
      run: () => threeQuarter({ side: {} })
    },
    {
      name: 'a head with no pivotA',
      run: () => verdict(threeQuarterFindings(withoutPivot(headSkin({}), 'backSide'), FACE_ONLY))
    },
    {
      name: 'a rig with no head and no torso part',
      run: () => verdict(threeQuarterFindings(headSkin({}), NO_PARTS)),
      measured: false
    }
  ],
  good: [
    { name: 'a frontSide head the minimum from the front head', run: () => threeQuarter(nearFront(THREE_QUARTER_MIN)) },
    { name: 'a backSide torso that differs from the back torso', run: () => torsoSkin(['mmmmmm', 'mmmmmm']) }
  ]
})

declareGate({
  gate: 'backViewFace',
  observes: 'files',
  frame: 'the skin sprites of the head parts in back and backSide, against the colours of the single-joint head ' +
    'parts in front that are not on the outline ring of any head part in front and not in the rear half (left ' +
    'of pivotA) of the single-joint head parts in side',
  threshold: `at most ${BACK_SLIVER} px of those face colours in a back view's head: fewer than a 2 by 2 eye`,
  bad: [
    {
      name: 'a back head with the front face as drawn',
      run: () => backFace({ ...backWithFace(0), back: { head: HEAD } })
    },
    {
      name: 'a back head with one pixel more than the sliver of face colour',
      run: () => backFace(backWithFace(BACK_SLIVER + 1))
    },
    { name: 'a backSide head with the face', run: () => backFace({ ...backWithFace(0), backSide: { head: HEAD } }) },
    { name: 'a scarf on the back head carrying the front head face colour', run: () => wornSkin(['sssss', 'sssss']) },
    { name: 'a back head with no sprite', run: () => backFace({ ...backWithFace(0), back: {} }) },
    { name: 'a front head with no sprite', run: () => backFace({ ...backWithFace(0), front: {} }) },
    {
      name: 'a front face with no colour of its own: nothing could be measured',
      run: () => backFace({ ...backWithFace(0), front: { head: HAIR } }),
      measured: false
    },
    {
      name: 'a rig with no face part',
      run: () => verdict(backFaceFindings(headSkin({}), NO_PARTS)),
      measured: false
    }
  ],
  good: [
    { name: 'a back head of hair colours only', run: () => backFace(backWithFace(0)) },
    {
      name: 'a back scarf in a colour that is on the front scarf outline and also inside the front head',
      run: () => wornSkin(['mmmmm', 'mmmmm'])
    },
    { name: 'a back head with a sliver of face colour', run: () => backFace(backWithFace(BACK_SLIVER)) },
    {
      name: 'a back head in a colour the front head uses on its outline ring',
      run: () => backFace({
        ...backWithFace(0),
        front: { head: ['.hhhhh.', 'hhhhhhh', 'hsesesh', 'hsssssh', '.nnnnn.'] },
        back: { head: ['.nnnnn.', 'nnnnnnn', 'nnnnnnn', 'nnnnnnn', '.nnnnn.'] }
      })
    }
  ]
})

declareGate({
  gate: 'sideProfile',
  observes: 'files',
  frame: 'the skin sprites of the head parts in the side view, each against its own mirror about the centre of its ' +
    'opaque bounding box, compared in colour',
  threshold: `the pixels differing, summed over the parts, number at least ${PROFILE_MIN}: a nose two pixels tall ` +
    'present on the facing side and absent on the other',
  bad: [
    { name: 'a head that is its own mirror', run: () => profile(HEAD) },
    { name: 'a nose one pixel tall, below the minimum', run: () => profile(noseOf(1)) },
    { name: 'a side head with no sprite', run: () => verdict(profileFindings(skinOf({ side: {} }), FACE_ONLY)) },
    { name: 'a symmetric head with its pivot moved off its centre', run: () => profilePivot(HEAD, [1, 2]) },
    { name: 'a symmetric head with transparent padding on one side', run: () => profilePivot(PADDED, [0, 2]) },
    { name: 'a symmetric head of even width', run: () => profile(EVEN) },
    {
      name: 'a head symmetric in shape whose two halves are different colours, but only by one pixel each',
      run: () => profile(['.hhhhh.', 'hhhhhhh', 'nsesesh', 'hsssssh', '.hhhhh.'])
    },
    {
      name: 'a rig with no face part',
      run: () => verdict(profileFindings(headSkin({}), NO_PARTS)),
      measured: false
    }
  ],
  good: [
    { name: 'a nose two pixels tall', run: () => profile(noseOf(2)) },
    { name: 'a profile with the face on the facing half', run: () => profile(SIDE_FACE) },
    { name: 'a profile with its pivot moved', run: () => profilePivot(SIDE_FACE, [1, 1]) },
    {
      name: 'a head symmetric in shape whose far half is another colour',
      run: () => profile(['.nnhhh.', 'nnhhhhh', 'nsesesh', 'hsssssh', '.hhhhh.'])
    }
  ]
})
