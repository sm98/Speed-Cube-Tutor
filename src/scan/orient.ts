import type { Cube } from '../cube/cube'
import { FACES, type Face } from '../cube/geometry'
import { validateCube } from '../cube/validate'

/**
 * The user can hold a face any way up, so a face's 3x3 may arrive turned by a quarter, half or
 * three-quarter turn. Real cubes are very constrained (every edge and corner must be a real piece),
 * so trying all 4^6 combinations and keeping the one that validates recovers the true orientation.
 */

/** For a clockwise quarter turn: new facelet position -> old position. */
const QUARTER = Array.from({ length: 9 }, (_, i) => 3 * (2 - (i % 3)) + Math.floor(i / 3))

/** rotationMap(k)[newIndex] = oldIndex after k clockwise quarter turns */
export function rotationMap(k: number): number[] {
  return Array.from({ length: 9 }, (_, i) => {
    let p = i
    for (let t = 0; t < k; t++) p = QUARTER[p]
    return p
  })
}

export interface Oriented {
  cube: Cube
  /** quarter turns applied to each face (0 = held the way the net draws it) */
  turns: Record<Face, number>
  /** facelet indices of the oriented cube corresponding to the given `uncertain` ones */
  uncertain: number[]
  /** true if the oriented cube is a legal cube */
  valid: boolean
}

export function resolveOrientation(cube: Cube, uncertain: number[] = []): Oriented {
  const maps = [0, 1, 2, 3].map(rotationMap)
  let best: { ks: number[]; issues: number; cost: number } | null = null

  for (let code = 0; code < 4 ** 6; code++) {
    const ks = FACES.map((_, f) => Math.floor(code / 4 ** f) % 4)
    const cost = ks.filter((k) => k !== 0).length
    if (best && cost >= best.cost && best.issues === 0) continue // can't beat a valid, cheaper answer
    const candidate = build(cube, ks, maps)
    const issues = validateCube(candidate).issues.length
    if (!best || issues < best.issues || (issues === best.issues && cost < best.cost)) best = { ks, issues, cost }
  }

  const ks = best!.ks
  const bad = new Set(uncertain)
  const moved: number[] = []
  FACES.forEach((_, f) => {
    for (let i = 0; i < 9; i++) if (bad.has(f * 9 + maps[ks[f]][i])) moved.push(f * 9 + i)
  })
  return {
    cube: build(cube, ks, maps),
    turns: Object.fromEntries(FACES.map((f, i) => [f, ks[i]])) as Record<Face, number>,
    uncertain: moved,
    valid: best!.issues === 0,
  }
}

function build(cube: Cube, ks: number[], maps: number[][]): Cube {
  return cube.map((_, idx) => {
    const f = Math.floor(idx / 9)
    return cube[f * 9 + maps[ks[f]][idx % 9]]
  })
}
