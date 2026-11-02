const FONT_PX = 12
const PADDING_PX = 5
const TAIL_PX = 5
const LINE = '#2b2118'
const FILL = '#fffaf0'

export function drawBubble (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  ratio: number
): void {
  context.save()
  context.font = `${FONT_PX * ratio}px system-ui, sans-serif`
  const width = context.measureText(text).width + 2 * PADDING_PX * ratio
  const height = (FONT_PX + 2 * PADDING_PX) * ratio
  const left = Math.round(x - width / 2)
  const top = Math.round(y - height - TAIL_PX * ratio)
  context.fillStyle = FILL
  context.strokeStyle = LINE
  context.lineWidth = Math.max(1, Math.round(ratio))
  context.beginPath()
  context.roundRect(left, top, width, height, 4 * ratio)
  context.moveTo(x - TAIL_PX * ratio, top + height)
  context.lineTo(x, top + height + TAIL_PX * ratio)
  context.lineTo(x + TAIL_PX * ratio, top + height)
  context.fill()
  context.stroke()
  context.fillStyle = LINE
  context.textBaseline = 'middle'
  context.fillText(text, left + PADDING_PX * ratio, top + height / 2)
  context.restore()
}
