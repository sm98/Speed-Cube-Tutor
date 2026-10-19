// Sticker geometry for a 3x3 cube.
//
// Coordinates: x points right, y up, z toward the viewer (the F face).
// Facelets use the standard net layout, 9 per face in the order U R F D L B:
//   index = faceIndex * 9 + row * 3 + col
// Each face's rows/cols follow the unfolded net (U has B at its top edge,
// D has F at its top edge, R/F/L/B have U at their top edge).

export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B'
export type Vec3 = [number, number, number]

export const FACES: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B']

export const NORMAL: Record<Face, Vec3> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
}

export interface Sticker {
  index: number
  face: Face
  row: number
  col: number
  pos: Vec3
  normal: Vec3
}

function cellPos(face: Face, r: number, c: number): Vec3 {
  switch (face) {
    case 'U': return [-1 + c, 1, -1 + r]
    case 'R': return [1, 1 - r, 1 - c]
    case 'F': return [-1 + c, 1 - r, 1]
    case 'D': return [-1 + c, -1, 1 - r]
    case 'L': return [-1, 1 - r, -1 + c]
    case 'B': return [1 - c, 1 - r, -1]
  }
}

export const STICKERS: readonly Sticker[] = FACES.flatMap((face, fi) =>
  Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3)
    const col = i % 3
    return { index: fi * 9 + i, face, row, col, pos: cellPos(face, row, col), normal: NORMAL[face] }
  }),
)

export const faceIndex = (f: Face): number => FACES.indexOf(f)
export const centerIndex = (f: Face): number => faceIndex(f) * 9 + 4

const key = (p: Vec3, n: Vec3) => `${p.join(',')}|${n.join(',')}`
const INDEX_BY_KEY = new Map(STICKERS.map((s) => [key(s.pos, s.normal), s.index]))

export function stickerAt(pos: Vec3, normal: Vec3): number {
  const i = INDEX_BY_KEY.get(key(pos, normal))
  if (i === undefined) throw new Error(`no sticker at ${pos} facing ${normal}`)
  return i
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const clean = (v: Vec3): Vec3 => [Math.round(v[0]) + 0, Math.round(v[1]) + 0, Math.round(v[2]) + 0]

/** Rotate v a quarter turn clockwise as seen from outside, looking down `axis` toward the origin. */
export function rotateCw(v: Vec3, axis: Vec3): Vec3 {
  // Rodrigues with theta = -90deg: v' = -(axis x v) + axis (axis . v)
  const c = cross(axis, v)
  const d = dot(axis, v)
  return clean([-c[0] + axis[0] * d, -c[1] + axis[1] * d, -c[2] + axis[2] * d])
}
