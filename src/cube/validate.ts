import { FACES, STICKERS, type Face, type Vec3 } from './geometry'
import type { Cube } from './cube'

interface Slot {
  name: string
  pos: Vec3
  /** sticker indices in a fixed (counter-clockwise for corners) order */
  stickers: number[]
  /** the faces those stickers belong to on a solved cube */
  solved: Face[]
}

const axisOf = (n: Vec3) => (n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2)
const NAME_ORDER: Face[] = ['U', 'D', 'F', 'B', 'R', 'L']

function buildSlots(): { corners: Slot[]; edges: Slot[] } {
  const byPos = new Map<string, number[]>()
  for (const s of STICKERS) {
    const k = s.pos.join(',')
    byPos.set(k, [...(byPos.get(k) ?? []), s.index])
  }
  const corners: Slot[] = []
  const edges: Slot[] = []
  for (const idxs of byPos.values()) {
    if (idxs.length < 2) continue
    const pos = STICKERS[idxs[0]].pos
    const stickers = [...idxs].sort((a, b) => axisOf(STICKERS[a].normal) - axisOf(STICKERS[b].normal))
    // Mirror-image corners list their axes in the opposite handedness; swap to keep one rotation sense.
    if (stickers.length === 3 && pos[0] * pos[1] * pos[2] < 0) [stickers[1], stickers[2]] = [stickers[2], stickers[1]]
    const solved = stickers.map((i) => STICKERS[i].face)
    const name = [...solved].sort((a, b) => NAME_ORDER.indexOf(a) - NAME_ORDER.indexOf(b)).join('')
    ;(stickers.length === 3 ? corners : edges).push({ name, pos, stickers, solved })
  }
  return { corners, edges }
}

const { corners: CORNER_SLOTS, edges: EDGE_SLOTS } = buildSlots()

function permutationParity(perm: number[]): number {
  const seen = new Array(perm.length).fill(false)
  let swaps = 0
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue
    let len = 0
    for (let j = i; !seen[j]; j = perm[j]) {
      seen[j] = true
      len++
    }
    swaps += len - 1
  }
  return swaps % 2
}

const isUD = (f: Face) => f === 'U' || f === 'D'

export interface Validation {
  valid: boolean
  issues: string[]
}

/** Checks that a facelet state is a cube you could physically build and reach by turning. */
export function validateCube(cube: Cube): Validation {
  const issues: string[] = []

  for (const f of FACES) {
    const n = cube.filter((x) => x === f).length
    if (n !== 9) issues.push(`Colour ${f} appears ${n} times (should be 9)`)
  }
  FACES.forEach((f, i) => {
    if (cube[i * 9 + 4] !== f) issues.push(`Centre of face ${f} is not its own colour`)
  })
  if (issues.length) return { valid: false, issues }

  // --- corners
  const cornerPerm: number[] = []
  const usedCorners = new Set<number>()
  let twist = 0
  CORNER_SLOTS.forEach((slot, i) => {
    const t = slot.stickers.map((j) => cube[j])
    let q = -1
    for (let c = 0; c < CORNER_SLOTS.length && q < 0; c++) {
      for (let k = 0; k < 3; k++) {
        if (CORNER_SLOTS[c].solved.every((f, m) => f === t[(m + k) % 3])) {
          q = c
          break
        }
      }
    }
    if (q < 0) {
      issues.push(`Corner ${slot.name} has colours (${t.join('')}) that don't exist together on a cube`)
      return
    }
    if (usedCorners.has(q)) issues.push(`Corner ${CORNER_SLOTS[q].name} appears more than once`)
    usedCorners.add(q)
    cornerPerm[i] = q
    const ud = t.findIndex(isUD)
    const ref = slot.stickers.findIndex((j) => STICKERS[j].normal[1] !== 0)
    twist += (ud - ref + 3) % 3
  })

  // --- edges
  const edgePerm: number[] = []
  const usedEdges = new Set<number>()
  let flip = 0
  EDGE_SLOTS.forEach((slot, i) => {
    const t = slot.stickers.map((j) => cube[j])
    const q = EDGE_SLOTS.findIndex((e) => e.solved.includes(t[0]) && e.solved.includes(t[1]))
    if (q < 0 || t[0] === t[1]) {
      issues.push(`Edge ${slot.name} has colours (${t.join('')}) that don't exist together on a cube`)
      return
    }
    if (usedEdges.has(q)) issues.push(`Edge ${EDGE_SLOTS[q].name} appears more than once`)
    usedEdges.add(q)
    edgePerm[i] = q
    const primary = t.find(isUD) ?? t.find((f) => f === 'F' || f === 'B')!
    const refAxis = slot.pos[1] !== 0 ? 1 : 2
    flip += axisOf(STICKERS[slot.stickers[t.indexOf(primary)]].normal) === refAxis ? 0 : 1
  })

  if (issues.length) return { valid: false, issues }

  if (twist % 3 !== 0) issues.push('One corner is twisted in place; this cube could not be solved by turning')
  if (flip % 2 !== 0) issues.push('One edge is flipped in place; this cube could not be solved by turning')
  if (permutationParity(cornerPerm) !== permutationParity(edgePerm))
    issues.push('Two pieces look swapped; this cube could not be solved by turning')

  return { valid: issues.length === 0, issues }
}
