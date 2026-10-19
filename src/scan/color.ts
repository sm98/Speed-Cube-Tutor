import { FACES, type Face } from '../cube/geometry'
import type { Cube } from '../cube/cube'

export type Lab = [number, number, number]
export type ColorName = 'white' | 'yellow' | 'red' | 'orange' | 'green' | 'blue'

export const COLOR_RGB: Record<ColorName, [number, number, number]> = {
  white: [236, 230, 226],
  yellow: [246, 226, 40],
  red: [222, 48, 44],
  orange: [255, 118, 24],
  green: [24, 165, 78],
  blue: [18, 78, 190],
}
const COLOR_NAMES = Object.keys(COLOR_RGB) as ColorName[]

export const colorHex = (name: ColorName): string =>
  '#' + COLOR_RGB[name].map((v) => v.toString(16).padStart(2, '0')).join('')

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lin = (v: number) => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/**
 * Colour distance. Lightness is down-weighted because lighting changes it the most, and the hue
 * part is counted twice: red vs orange differ mostly in hue, and must not blur together.
 */
export function labDist(a: Lab, b: Lab): number {
  const dl = (a[0] - b[0]) * 0.45
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  const dc = Math.hypot(a[1], a[2]) - Math.hypot(b[1], b[2])
  const dh2 = Math.max(0, da * da + db * db - dc * dc)
  return Math.sqrt(dl * dl + da * da + db * db + dh2)
}

const REF_LAB = COLOR_NAMES.map((n) => rgbToLab(...COLOR_RGB[n]))

/**
 * Name a colour by its hue, not by distance to a fixed palette. Real cubes vary a lot (some "orange"
 * is nearly red, some "red" nearly crimson) and lamps shift everything, but the order of hues never
 * changes, and each name owns a wide band of it. Greys and whites are told apart by low chroma.
 * `dist` is how far the colour is from the closest standard sticker colour, a rough "is this a sticker" check.
 */
export function nearestName(lab: Lab): { name: ColorName; dist: number } {
  let dist = Infinity
  for (const ref of REF_LAB) dist = Math.min(dist, labDist(lab, ref))
  const chroma = Math.hypot(lab[1], lab[2])
  // White is bright and colourless. A dark, nearly colourless sticker is a navy blue in dim light, not white.
  if (chroma < 24 && lab[0] >= 48) return { name: 'white', dist }
  // Lab hue angle, with the cut placed between blue and crimson red
  const h = (((Math.atan2(lab[2], lab[1]) * 180) / Math.PI) + 360 + 30) % 360
  const name: ColorName = h < 72 ? 'red' : h < 102 ? 'orange' : h < 155 ? 'yellow' : h < 260 ? 'green' : 'blue'
  return { name, dist }
}

export interface Classification {
  cube: Cube
  /** which real colour each face letter (identified by its centre) turned out to be */
  scheme: Record<Face, ColorName>
  warnings: string[]
  /** facelet indices the classifier was not confident about (worth a second look) */
  uncertain: number[]
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]))
}
const PERMS = permutations([0, 1, 2, 3, 4, 5])

/**
 * Turn 54 measured sticker colours (9 per face, in facelet order) into a cube state.
 * The six centres define the six colours. Every other sticker joins its nearest colour
 * (colours adapt to the lighting over a few rounds); then, since each colour has exactly
 * 8 non-centre stickers, any overfull colour gives up its least certain stickers.
 */
export function classifyCube(labs: Record<Face, Lab[]>): Classification {
  const warnings: string[] = []
  const all: Lab[] = FACES.flatMap((f) => labs[f])
  const dist = (s: number, protos: Lab[]) => protos.map((p) => labDist(all[s], p))
  let protos: Lab[] = FACES.map((f) => labs[f][4])
  let assign: number[] = new Array(54).fill(0)

  for (let iter = 0; iter < 4; iter++) {
    assign = all.map((_, s) => {
      if (s % 9 === 4) return Math.floor(s / 9) // centre keeps its own colour
      const d = dist(s, protos)
      return d.indexOf(Math.min(...d))
    })
    protos = protos.map((_, c) => {
      const members = all.filter((_, s) => assign[s] === c)
      return [0, 1, 2].map((k) => members.reduce((sum, m) => sum + m[k], 0) / members.length) as Lab
    })
  }

  const uncertain = new Set<number>()
  all.forEach((_, s) => {
    if (s % 9 === 4) return
    const d = dist(s, protos).sort((a, b) => a - b)
    if (d[0] > 0.7 * d[1]) uncertain.add(s)
  })

  // repair: an overfull colour hands its least-certain stickers to a colour with room
  const count = (c: number) => assign.filter((a, s) => a === c && s % 9 !== 4).length
  for (let guard = 0; guard < 60; guard++) {
    const over = FACES.findIndex((_, c) => count(c) > 8)
    if (over < 0) break
    let best: { s: number; to: number; cost: number } | null = null
    all.forEach((_, s) => {
      if (assign[s] !== over || s % 9 === 4) return
      const d = dist(s, protos)
      d.forEach((dc, to) => {
        if (to !== over && count(to) < 8 && (!best || dc - d[over] < best.cost)) best = { s, to, cost: dc - d[over] }
      })
    })
    if (!best) break
    const move = best as { s: number; to: number }
    assign[move.s] = move.to
    uncertain.add(move.s)
  }

  // name the six colours: best one-to-one match against the standard sticker colours
  let bestPerm = PERMS[0]
  let bestCost = Infinity
  for (const perm of PERMS) {
    const cost = perm.reduce((sum, ci, f) => sum + labDist(protos[f], REF_LAB[ci]), 0)
    if (cost < bestCost) {
      bestCost = cost
      bestPerm = perm
    }
  }
  const scheme = Object.fromEntries(FACES.map((f, i) => [f, COLOR_NAMES[bestPerm[i]]])) as Record<Face, ColorName>

  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      if (labDist(protos[i], protos[j]) < 12) {
        warnings.push(`Centres ${scheme[FACES[i]]} and ${scheme[FACES[j]]} look very similar; check the lighting`)
      }
    }
  }

  return { cube: assign.map((c) => FACES[c]), scheme, warnings, uncertain: [...uncertain].sort((a, b) => a - b) }
}

export type Rgb = [number, number, number]
export type Gains = [number, number, number]
export const NO_GAINS: Gains = [1, 1, 1]

/**
 * Indoor light is rarely white: a warm lamp turns white stickers brown-grey and yellow stickers olive.
 * The least colourful bright sticker in view is almost certainly white, so scale the channels until it
 * is neutral. When no white sticker is in view the previous correction is kept.
 */
export function estimateGains(rgbs: Rgb[], prev: Gains): Gains {
  if (!rgbs.length) return prev
  const vmax = Math.max(...rgbs.map((c) => Math.max(...c)))
  let best: Rgb | null = null
  let bestS = 0.3
  for (const c of rgbs) {
    const v = Math.max(...c)
    const s = (v - Math.min(...c)) / (v || 1)
    if (v >= 0.5 * vmax && s < bestS) {
      best = c
      bestS = s
    }
  }
  if (!best) return prev
  const m = (best[0] + best[1] + best[2]) / 3
  const clip = (g: number) => Math.min(1.9, Math.max(0.55, g))
  const target: Gains = [clip(m / (best[0] || 1)), clip(m / (best[1] || 1)), clip(m / (best[2] || 1))]
  // ease toward the new estimate so the colours don't flicker from frame to frame
  return [0, 1, 2].map((k) => prev[k] * 0.6 + target[k] * 0.4) as Gains
}

export const labFrom = (c: Rgb, g: Gains = NO_GAINS): Lab =>
  rgbToLab(Math.min(255, c[0] * g[0]), Math.min(255, c[1] * g[1]), Math.min(255, c[2] * g[2]))

/**
 * Correct a lamp's colour cast before any colour is classified. The most colourless of the bright pixels
 * in a picture of a cube are white stickers or a pale wall, which should be neutral; if they lean orange
 * (a warm lamp), scale the channels until they don't. Skipped when even the most colourless bright
 * pixels are strongly coloured, so a picture of just a yellow face isn't "corrected".
 */
export function whitePatchGains(data: ArrayLike<number>, pixels: number): Gains {
  const v = new Float32Array(pixels)
  const sat = new Float32Array(pixels)
  let vmax = 0
  for (let i = 0; i < pixels; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    v[i] = Math.max(r, g, b)
    sat[i] = v[i] ? (v[i] - Math.min(r, g, b)) / v[i] : 0
    vmax = Math.max(vmax, v[i])
  }
  const sats: number[] = []
  for (let i = 0; i < pixels; i++) if (v[i] >= 0.5 * vmax) sats.push(sat[i])
  if (sats.length < 30) return NO_GAINS
  sats.sort((a, b) => a - b)
  const cut = sats[Math.floor(sats.length * 0.12)]
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < pixels; i++) {
    if (v[i] < 0.5 * vmax || sat[i] > cut) continue
    r += data[i * 4]
    g += data[i * 4 + 1]
    b += data[i * 4 + 2]
    n++
  }
  if (!n) return NO_GAINS
  const m = [r / n, g / n, b / n]
  const hi = Math.max(...m)
  if ((hi - Math.min(...m)) / (hi || 1) > 0.45) return NO_GAINS // strongly coloured: not a white reference
  const clip = (x: number) => Math.min(1.8, Math.max(0.8, x))
  return [clip(hi / m[0]), clip(hi / m[1]), clip(hi / m[2])]
}

export function applyGains(img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, g: Gains) {
  const out = new Uint8ClampedArray(img.data.length)
  for (let i = 0; i < img.data.length; i += 4) {
    out[i] = Math.min(255, img.data[i] * g[0])
    out[i + 1] = Math.min(255, img.data[i + 1] * g[1])
    out[i + 2] = Math.min(255, img.data[i + 2] * g[2])
    out[i + 3] = 255
  }
  return { data: out, width: img.width, height: img.height }
}
