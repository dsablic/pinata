import { join } from 'node:path'
import { writeOutput } from '../diagnostics/report.ts'
import type { Image } from '../image.ts'
import { buildChoicePacket } from '../judge/choice.ts'
import type { ChoiceItem, ChoiceSpec } from '../judge/choice.ts'
import { encodePng } from '../png/encode.ts'

export type PanelBase = Omit<ChoiceSpec, 'items' | 'background'>
export type PanelItem = ChoiceItem & { picture: Image }

const BACKGROUND = '#c8c8c8'

export function writeChoicePanel (out: string, base: PanelBase, pictures: PanelItem[]): string {
  const items = pictures.map(({ picture, ...item }) => item)
  const loaded = new Map(pictures.map(item => [item.image, item.picture]))
  for (const [path, picture] of loaded) writeOutput(join(out, path), encodePng(picture))
  const spec: ChoiceSpec = { ...base, background: BACKGROUND, items }
  writeOutput(join(out, 'panel.json'), `${JSON.stringify({ ...base, items }, null, 2)}\n`)
  const packet = buildChoicePacket(spec, path => loaded.get(path) as Image)
  for (const [file, image] of Object.entries(packet.images)) writeOutput(join(out, 'packet', file), encodePng(image))
  writeOutput(join(out, 'packet', 'questions.md'), packet.questions)
  writeOutput(join(out, 'key.json'), `${JSON.stringify(packet.key, null, 2)}\n`)
  return `${Object.keys(packet.images).length} items in ${join(out, 'packet')}; key in ${join(out, 'key.json')}`
}
