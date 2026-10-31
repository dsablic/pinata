export type Mark = 'ground' | 'wall'
export type Box = { id: number, mark: Mark, left: number, top: number, width: number, height: number }
export type Surface = { id: number, from: number, to: number, height: number }
export type Wall = { id: number, x: number, bottom: number, top: number }
export type Ground = { surfaces: Surface[], walls: Wall[] }

const NARROWEST_GROUND_PX = 4

export function groundOf (boxes: Box[], pixelsPerMetre: number): Ground {
  const toMetres = (px: number): number => px / pixelsPerMetre
  const surfaces: Surface[] = []
  const walls: Wall[] = []
  for (const box of boxes) {
    const top = -toMetres(box.top)
    const bottom = -toMetres(box.top + box.height)
    if (box.mark === 'ground' && box.width >= NARROWEST_GROUND_PX) {
      surfaces.push({ id: box.id, from: toMetres(box.left), to: toMetres(box.left + box.width), height: top })
    } else if (box.mark === 'wall' && box.height > 0) {
      walls.push({ id: box.id, x: toMetres(box.left), bottom, top })
      walls.push({ id: box.id, x: toMetres(box.left + box.width), bottom, top })
    }
  }
  return { surfaces, walls }
}

export function surfaceBelow (ground: Ground, x: number, standingHeight: number, stepHeight = 0): Surface | undefined {
  let best: Surface | undefined
  for (const s of ground.surfaces) {
    if (x < s.from || x > s.to || s.height > standingHeight + stepHeight) continue
    if (best === undefined || s.height > best.height) best = s
  }
  return best
}

export function heightUnder (
  ground: Ground,
  standingHeight: () => number,
  stepHeight: number
): (x: number, z: number) => number {
  return x => {
    const surface = surfaceBelow(ground, x, standingHeight(), stepHeight)
    return surface?.height ?? standingHeight() - DEPTH_WITH_NO_GROUND
  }
}

const DEPTH_WITH_NO_GROUND = 1000
