import { describe, expect, it } from 'vitest'
import { applyMoves, solvedCube } from '../cube/cube'
import { FACES, type Face } from '../cube/geometry'
import { validateCube } from '../cube/validate'
import { COLOR_RGB, classifyCube, nearestName, rgbToLab, type ColorName, type Lab } from './color'
import { rotationMap } from './orient'
import { assignFaces, ScanSession, StabilityGate } from './session'

// a physical cube: face letter (identified by centre) -> real colour
const SCHEME: Record<Face, ColorName> = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' }

const rand = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32

/** What a camera might measure: the true colour, shifted by lighting and noise. */
function measure(cube: Face[], r: () => number, tint: [number, number, number], noise: number): Record<Face, Lab[]> {
  const out = {} as Record<Face, Lab[]>
  FACES.forEach((f, fi) => {
    out[f] = Array.from({ length: 9 }, (_, i) => {
      const rgb = COLOR_RGB[SCHEME[cube[fi * 9 + i]]]
      const px = rgb.map((v, k) => Math.max(0, Math.min(255, v * tint[k] + (r() - 0.5) * 2 * noise)))
      return rgbToLab(px[0], px[1], px[2])
    })
  })
  return out
}

describe('classifyCube', () => {
  const scrambles = ["R U R' U' F2 D L2 B' U2", "F R U' L D2 B R2 U F'", 'R2 L2 U2 D2 F2 B2']

  for (const [name, tint] of [
    ['neutral light', [1, 1, 1]],
    ['warm light', [1, 0.93, 0.8]],
    ['dim cool light', [0.75, 0.82, 0.9]],
  ] as const) {
    it(`recovers scrambles under ${name}`, () => {
      const r = rand(5)
      for (const s of scrambles) {
        const truth = applyMoves(solvedCube(), s)
        const got = classifyCube(measure(truth, r, [...tint], 14))
        expect(got.cube).toEqual(truth)
        expect(got.scheme).toEqual(SCHEME)
        expect(validateCube(got.cube).valid).toBe(true)
      }
    })
  }
})

describe('classifyCube under uneven lighting', () => {
  it('copes with each face lit differently and flags the glare sticker', () => {
    const r = rand(11)
    const truth = applyMoves(solvedCube(), "R U R' U' F2 D L2 B' U2")
    const tints: Record<Face, [number, number, number]> = {
      U: [1, 1, 1], R: [0.9, 0.9, 0.85], F: [1, 0.95, 0.85], D: [0.7, 0.75, 0.8], L: [0.85, 0.8, 0.8], B: [1, 1, 0.9],
    }
    const labs = {} as Record<Face, Lab[]>
    FACES.forEach((f, fi) => {
      const one = measure(truth, r, tints[f], 12)
      labs[f] = one[f]
    })
    // glare washes one white sticker towards yellow-ish grey on face F (index 18+1 region)
    const got = classifyCube(labs)
    expect(got.cube).toEqual(truth)
    expect(validateCube(got.cube).valid).toBe(true)
  })

  it('reports a confused sticker as uncertain and keeps 9 of each colour', () => {
    const r = rand(3)
    const truth = applyMoves(solvedCube(), "R U R' U'")
    const labs = measure(truth, r, [1, 1, 1], 6)
    // a red sticker that looks half orange
    labs.F[0] = rgbToLab(230, 65, 30)
    const got = classifyCube(labs)
    for (const f of FACES) expect(got.cube.filter((x) => x === f).length).toBe(9)
    expect(got.uncertain).toContain(18)
  })
})

describe('assignFaces: identify the six faces from the hue order of their centres', () => {
  const NAMES: ColorName[] = ['white', 'yellow', 'red', 'orange', 'green', 'blue']
  const EXPECT: Record<ColorName, Face> = { white: 'U', red: 'R', orange: 'L', yellow: 'D', green: 'F', blue: 'B' }
  const lab = (n: ColorName, tint: [number, number, number], scale = 1): Lab => rgbToLab(...(COLOR_RGB[n].map((v, k) => Math.min(255, v * tint[k] * scale)) as [number, number, number]))

  it.each([
    ['neutral light', [1, 1, 1], 1],
    ['warm lamp', [1, 0.86, 0.62], 1],
    ['cool daylight', [0.8, 0.92, 1], 1],
    ['dim room', [1, 0.95, 0.85], 0.55],
  ] as const)('gets every face right under %s, whatever order they were shown', (_n, tint, scale) => {
    const r = rand(17)
    for (let t = 0; t < 10; t++) {
      const order = [...NAMES].sort(() => r() - 0.5)
      const got = assignFaces(order.map((n) => lab(n, [...tint], scale)))
      expect(got).toEqual(order.map((n) => EXPECT[n]))
    }
  })

  it('still separates a red-orange cube from a dark red', () => {
    // orange that leans red (hue ~12deg) next to a deep red
    const centres = [rgbToLab(236, 230, 226), rgbToLab(246, 226, 40), rgbToLab(160, 25, 35), rgbToLab(240, 85, 25), rgbToLab(24, 165, 78), rgbToLab(18, 78, 190)]
    expect(assignFaces(centres)).toEqual(['U', 'D', 'R', 'L', 'F', 'B'])
  })
})

describe('ScanSession', () => {
  const flat = (name: ColorName, centre: ColorName = name): Lab[] =>
    Array.from({ length: 9 }, (_, i) => rgbToLab(...COLOR_RGB[i === 4 ? centre : name]))

  it('accepts any new face in any order and rejects a repeated one', () => {
    const s = new ScanSession()
    expect(s.capture(flat('blue'))).toBe(0)
    expect(s.check(flat('blue')).ok).toBe(false)
    expect(s.check(flat('green')).ok).toBe(true)
    expect(s.capture(flat('yellow'))).toBe(1)
    expect(s.captures.length).toBe(2)
  })

  it('lets a face be retaken', () => {
    const s = new ScanSession()
    s.capture(flat('red'))
    s.capture(flat('blue'))
    s.retake(0)
    expect(s.captures.length).toBe(1)
    expect(s.check(flat('red')).ok).toBe(true)
  })

  it('recovers the cube when faces were scanned in a random order, under a warm lamp, held at random rotations', () => {
    const r = rand(99)
    for (const scramble of ["R U R' U' F2 D L2 B' U2", "F R U' L D2 B R2 U F'", "L' D F2 R U2 B' L D'"]) {
      const truth = applyMoves(solvedCube(), scramble)
      const labs = measure(truth, r, [1, 0.88, 0.7], 8)
      const session = new ScanSession()
      for (const f of [...FACES].sort(() => r() - 0.5)) {
        const k = Math.floor(r() * 4) // how the user happened to hold this face
        session.capture(labs[f].map((_, i) => labs[f][rotationMap((4 - k) % 4)[i]]))
      }
      const out = session.result()
      expect(out.cube).toEqual(truth)
      expect(out.oriented.valid).toBe(true)
    }
  })
})

describe('StabilityGate', () => {
  const face = (name: ColorName, centre: ColorName = name): Lab[] =>
    Array.from({ length: 9 }, (_, i) => rgbToLab(...COLOR_RGB[i === 4 ? centre : name]))

  it('fires once the centre colour holds steady, then waits for a new centre', () => {
    const g = new StabilityGate(450)
    expect(g.push(face('red'), 0)).toBe(0)
    expect(g.push(face('red'), 225)).toBeCloseTo(0.5, 1)
    expect(g.push(face('red'), 450)).toBe(1)
    g.markCaptured(face('red'))
    expect(g.push(face('red'), 2000)).toBe(0)
    expect(g.push(face('blue'), 2100)).toBe(0)
    expect(g.push(face('blue'), 2600)).toBe(1)
  })

  it('tolerates small sticker noise but waits while the cube is still turning', () => {
    const g = new StabilityGate(450)
    const jitter = (l: Lab): Lab => [l[0] + 3, l[1] + 3, l[2] - 3]
    g.push(face('red'), 0)
    expect(g.push(face('red').map(jitter), 500)).toBe(1)
    const g2 = new StabilityGate(450)
    g2.push(face('red', 'blue'), 0)
    expect(g2.push(face('green', 'blue'), 500)).toBe(0) // same centre, stickers swapped: cube mid-turn
  })

  it('restarts the timer when the centre colour changes', () => {
    const g = new StabilityGate(450)
    g.push(face('red'), 0)
    g.push(face('blue'), 300)
    expect(g.push(face('blue'), 400)).toBeLessThan(0.3)
  })

  it('reports the per-sticker median of recent frames', () => {
    const g = new StabilityGate(450)
    g.push(face('red'), 0)
    g.push(face('red'), 100)
    g.push(face('red').map((l, i): Lab => (i === 0 ? [l[0] + 12, l[1], l[2]] : l)), 200) // one off frame
    g.push(face('red'), 300)
    expect(g.reading()[0]).toEqual(rgbToLab(...COLOR_RGB.red))
  })
})

describe('nearestName', () => {
  const name = (r: number, g: number, b: number) => nearestName(rgbToLab(r, g, b)).name

  it('calls a dark navy blue "blue", not white, even when it looks almost grey', () => {
    expect(name(35, 50, 85)).toBe('blue')
    expect(name(28, 40, 70)).toBe('blue')
    expect(name(45, 58, 90)).toBe('blue')
  })

  it('still calls bright, colourless stickers white, even in shadow or warm light', () => {
    expect(name(236, 230, 226)).toBe('white')
    expect(name(165, 155, 150)).toBe('white')
    expect(name(190, 180, 160)).toBe('white')
  })

  it('separates the real sticker colours seen on a webcam', () => {
    expect(name(213, 79, 35)).toBe('orange') // orange that leans red
    expect(name(153, 40, 34)).toBe('red') // dark red
    expect(name(158, 148, 45)).toBe('yellow') // olive-looking yellow
    expect(name(29, 102, 41)).toBe('green')
  })
})
