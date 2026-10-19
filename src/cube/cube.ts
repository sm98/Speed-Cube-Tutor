import { FACES, NORMAL, STICKERS, rotateCw, stickerAt, type Face } from './geometry'

/**
 * A cube is 54 facelets, each holding the face its colour belongs to
 * (identified by that face's centre). So a solved cube is UUUUUUUUU RRRRRRRRR ...
 */
export type Cube = Face[]

export interface Move {
  face: Face
  /** 1 = clockwise quarter, 2 = half turn, 3 = counter-clockwise quarter */
  turns: 1 | 2 | 3
}

export const solvedCube = (): Cube => FACES.flatMap((f) => Array<Face>(9).fill(f))

export const isSolved = (cube: Cube): boolean => cube.every((f, i) => f === FACES[Math.floor(i / 9)])

// destination index of every sticker after a clockwise quarter turn of each face
const QUARTER: Record<Face, number[]> = Object.fromEntries(
  FACES.map((face) => {
    const axis = NORMAL[face]
    const dest = STICKERS.map((s) => {
      const inLayer = s.pos[0] * axis[0] + s.pos[1] * axis[1] + s.pos[2] * axis[2] === 1
      if (!inLayer) return s.index
      return stickerAt(rotateCw(s.pos, axis), rotateCw(s.normal, axis))
    })
    return [face, dest]
  }),
) as Record<Face, number[]>

export function applyMove(cube: Cube, move: Move): Cube {
  let cur = cube
  for (let t = 0; t < move.turns; t++) {
    const next = cur.slice()
    QUARTER[move.face].forEach((to, from) => {
      next[to] = cur[from]
    })
    cur = next
  }
  return cur
}

export function applyMoves(cube: Cube, moves: Move[] | string): Cube {
  const list = typeof moves === 'string' ? parseMoves(moves) : moves
  return list.reduce(applyMove, cube)
}

export function parseMoves(notation: string): Move[] {
  const tokens = notation.trim().split(/\s+/).filter(Boolean)
  return tokens.map((tok) => {
    const m = /^([URFDLB])(2|')?$/.exec(tok)
    if (!m) throw new Error(`bad move "${tok}"`)
    return { face: m[1] as Face, turns: m[2] === '2' ? 2 : m[2] === "'" ? 3 : 1 }
  })
}

export const formatMove = (m: Move): string => m.face + (m.turns === 2 ? '2' : m.turns === 3 ? "'" : '')
export const formatMoves = (ms: Move[]): string => ms.map(formatMove).join(' ')

export const invertMoves = (ms: Move[]): Move[] =>
  ms.map((m) => ({ face: m.face, turns: (4 - m.turns) as Move['turns'] })).reverse()
