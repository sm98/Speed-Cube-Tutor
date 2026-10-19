import { describe, expect, it } from 'vitest'
import { applyMove, applyMoves, formatMoves, invertMoves, isSolved, parseMoves, solvedCube } from './cube'
import { FACES, type Face } from './geometry'
import { validateCube } from './validate'

const rand = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
const randomScramble = (n: number, r: () => number) =>
  Array.from({ length: n }, () => FACES[Math.floor(r() * 6)] + ["", "'", '2'][Math.floor(r() * 3)]).join(' ')

describe('moves', () => {
  it('parses and formats notation', () => {
    expect(formatMoves(parseMoves("R U2 F' D L B"))).toBe("R U2 F' D L B")
    expect(() => parseMoves('X')).toThrow()
  })

  it.each(FACES)('%s has order 4, and its inverse undoes it', (f) => {
    const s = solvedCube()
    const once = applyMove(s, { face: f, turns: 1 })
    expect(isSolved(once)).toBe(false)
    expect(isSolved(applyMoves(s, [f, f, f, f].join(' ')))).toBe(true)
    expect(isSolved(applyMoves(once, `${f}'`))).toBe(true)
    expect(isSolved(applyMoves(s, `${f}2 ${f}2`))).toBe(true)
  })

  it('U turns the front row from the right face (clockwise seen from above)', () => {
    const c = applyMoves(solvedCube(), 'U')
    const row = (f: Face, r: number) => [0, 1, 2].map((i) => c[FACES.indexOf(f) * 9 + r * 3 + i])
    expect(row('F', 0)).toEqual(['R', 'R', 'R'])
    expect(row('R', 0)).toEqual(['B', 'B', 'B'])
    expect(row('B', 0)).toEqual(['L', 'L', 'L'])
    expect(row('L', 0)).toEqual(['F', 'F', 'F'])
    expect(row('F', 1)).toEqual(['F', 'F', 'F'])
  })

  it('R carries the front column up to U (clockwise seen from the right)', () => {
    const c = applyMoves(solvedCube(), 'R')
    const u = FACES.indexOf('U') * 9
    expect([c[u + 2], c[u + 5], c[u + 8]]).toEqual(['F', 'F', 'F'])
  })

  it('(R U R\' U\') x6 is the identity, and x3 is not', () => {
    expect(isSolved(applyMoves(solvedCube(), Array(6).fill("R U R' U'").join(' ')))).toBe(true)
    expect(isSolved(applyMoves(solvedCube(), Array(3).fill("R U R' U'").join(' ')))).toBe(false)
  })

  it('random scrambles undo cleanly', () => {
    const r = rand(7)
    for (let i = 0; i < 20; i++) {
      const moves = parseMoves(randomScramble(30, r))
      const scrambled = applyMoves(solvedCube(), moves)
      expect(isSolved(applyMoves(scrambled, invertMoves(moves)))).toBe(true)
    }
  })
})

describe('validation', () => {
  it('accepts solved and many scrambled cubes', () => {
    expect(validateCube(solvedCube())).toEqual({ valid: true, issues: [] })
    const r = rand(42)
    for (let i = 0; i < 200; i++) {
      const v = validateCube(applyMoves(solvedCube(), randomScramble(25, r)))
      expect(v.issues).toEqual([])
    }
  })

  it('rejects wrong colour counts', () => {
    const c = solvedCube()
    c[0] = 'R'
    expect(validateCube(c).valid).toBe(false)
  })

  it('rejects an impossible piece', () => {
    const c = solvedCube()
    // swap two stickers of different pieces without fixing the rest
    ;[c[8], c[9 + 2]] = [c[9 + 2], c[8]]
    expect(validateCube(c).valid).toBe(false)
  })

  it('rejects a flipped edge', () => {
    const c = solvedCube()
    // UF edge: U[7] and F[1]
    ;[c[7], c[18 + 1]] = [c[18 + 1], c[7]]
    const v = validateCube(c)
    expect(v.valid).toBe(false)
    expect(v.issues.join(' ')).toMatch(/flipped/)
  })

  it('rejects a twisted corner', () => {
    const c = solvedCube()
    // UFR corner: U[8], R[0], F[2] -> rotate in place
    const [u, r, f] = [c[8], c[9], c[18 + 2]]
    c[8] = f
    c[9] = u
    c[18 + 2] = r
    const v = validateCube(c)
    expect(v.valid).toBe(false)
    expect(v.issues.join(' ')).toMatch(/twisted/)
  })

  it('rejects swapped edges (parity)', () => {
    const c = solvedCube()
    // swap UF and UR edges completely
    ;[c[7], c[5]] = [c[5], c[7]]
    ;[c[18 + 1], c[9 + 1]] = [c[9 + 1], c[18 + 1]]
    const v = validateCube(c)
    expect(v.valid).toBe(false)
    expect(v.issues.join(' ')).toMatch(/swapped/)
  })
})
