import { type Face } from '../cube/geometry'
import { labFrom, NO_GAINS, type Gains, type Lab, type Rgb } from './color'
import { fitBoxAll, mismatch, probeOf, type Probe } from './cuboid'
import { facing, make, MODEL, type Pose } from './pose'
import { stickerClass, type Pixels } from './stickers'

/**
 * Locate the cube and read every visible sticker.
 *
 * 1. The cube's outline gives a rough pose (see cuboid.ts).
 * 2. That pose is refined until every projected sticker cell covers one clean sticker colour:
 *    sticker boundaries in the picture must land on cell boundaries, which pins down the exact grid
 *    on each of the (up to three) visible faces at once.
 */

type V2 = [number, number]
type V3 = [number, number, number]

const DEG = Math.PI / 180
/** Faces turned more than ~83 degrees away are too thin to read (cleanliness is checked per cell on top of this)... */
const MIN_FACING = 0.12
/** ...but while *fitting* even thin faces count, so a pose can't win by hiding a face at a grazing angle. */
const FIT_FACING = 0.08
const OFFS = [-0.2, 0, 0.2]

function cellMismatch(cls: Uint8Array, W: number, H: number, pose: Pose): { mean: number; cells: number } {
  const m = make(pose, W, H)
  const counts = new Uint8Array(7)
  let total = 0
  let cells = 0
  for (const fm of MODEL) {
    if (facing(m, fm) < FIT_FACING) continue
    for (const c of fm.centers) {
      counts.fill(0)
      for (const dv of OFFS) {
        for (const du of OFFS) {
          const p = m.px(m.toCam([c[0] + fm.a[0] * du + fm.b[0] * dv, c[1] + fm.a[1] * du + fm.b[1] * dv, c[2] + fm.a[2] * du + fm.b[2] * dv]))
          const x = Math.round(p[0])
          const y = Math.round(p[1])
          counts[x < 0 || y < 0 || x >= W || y >= H ? 0 : cls[y * W + x]]++
        }
      }
      let top = 1
      for (let k = 2; k <= 6; k++) if (counts[k] > counts[top]) top = k
      total += 9 - counts[top]
      cells++
    }
  }
  return { mean: cells ? total / cells : Infinity, cells }
}

/** Lower is better: unclean cells (0..9 each) plus how badly the outline misses the cube patch. */
function energy(cls: Uint8Array, pr: Probe, pose: Pose): number {
  const sil = mismatch(pr, pose)
  if (!isFinite(sil)) return Infinity
  const cm = cellMismatch(cls, pr.W, pr.H, pose)
  return cm.cells ? cm.mean + 14 * sil : Infinity
}

export interface CubeFit {
  pose: Pose
  energy: number
}

function climb(cls: Uint8Array, pr: Probe, start: Pose, k0: number): CubeFit {
  const W = pr.W
  let p = start
  let e = energy(cls, pr, p)
  for (let k = k0; k > 0.02; k *= 0.7) {
    let improved = true
    for (let guard = 0; improved && guard < 25; guard++) {
      improved = false
      for (const dir of [-1, 1]) {
        const moves: Pose[] = [
          { ...p, yaw: p.yaw + dir * k * 6 * DEG },
          { ...p, pitch: p.pitch + dir * k * 6 * DEG },
          { ...p, roll: p.roll + dir * k * 6 * DEG },
          { ...p, tx: p.tx + dir * k * 0.03 * W },
          { ...p, ty: p.ty + dir * k * 0.03 * W },
          { ...p, d: Math.max(2.4, p.d + dir * k * 0.35) },
          { ...p, f: Math.min(1.6 * W, Math.max(0.45 * W, p.f + dir * k * 0.06 * W)) },
        ]
        for (const q of moves) {
          const eq = energy(cls, pr, q)
          if (eq < e) {
            p = q
            e = eq
            improved = true
          }
        }
      }
    }
  }
  return { pose: p, energy: e }
}

/**
 * `hint` (last frame's pose) makes this a quick local refinement that follows the cube; without it the
 * outline search runs first. Either way the result is polished against the sticker cells.
 */
/** `cls` is the lenient class map (cells), `mask` the strict cube outline (see face.ts). */
export function fitCube(cls: Uint8Array, mask: Uint8Array, W: number, H: number, hint?: Pose | null, top = 4): CubeFit | null {
  const pr = probeOf(mask, W, H)
  if (!pr) return null
  if (hint) return climb(cls, pr, hint, 0.4)
  let best: CubeFit | null = null
  for (const c of fitBoxAll(mask, W, H, null, { top }).slice(0, top)) {
    const f = climb(cls, pr, c.pose, 0.6)
    if (!best || f.energy < best.energy) best = f
  }
  return best
}

/** Projective map from the unit square (u across, v down) onto a quadrilateral q00, q10, q11, q01. */
function squareToQuad(q: V2[]): (u: number, v: number) => V2 {
  const [p0, p1, p2, p3] = q
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0]
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1]
  const den = dx1 * dy2 - dx2 * dy1
  const g = Math.abs(den) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / den
  const h = Math.abs(den) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / den
  const a = p1[0] - p0[0] + g * p1[0]
  const b = p3[0] - p0[0] + h * p3[0]
  const d = p1[1] - p0[1] + g * p1[1]
  const e = p3[1] - p0[1] + h * p3[1]
  return (u, v) => {
    const w = g * u + h * v + 1
    return [(a * u + b * v + p0[0]) / w, (d * u + e * v + p0[1]) / w]
  }
}

function quadMismatch(cls: Uint8Array, W: number, H: number, q: V2[]): number {
  const map = squareToQuad(q)
  const counts = new Uint8Array(7)
  let total = 0
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      counts.fill(0)
      for (const dv of OFFS) {
        for (const du of OFFS) {
          const [px, py] = map((i + 0.5 + du * 1.6) / 3, (j + 0.5 + dv * 1.6) / 3)
          const x = Math.round(px)
          const y = Math.round(py)
          counts[x < 0 || y < 0 || x >= W || y >= H ? 0 : cls[y * W + x]]++
        }
      }
      let top = 1
      for (let k = 2; k <= 6; k++) if (counts[k] > counts[top]) top = k
      total += 9 - counts[top]
    }
  }
  return total
}

/**
 * The pose gets each face almost right; lens distortion and the camera guess leave it a few pixels off.
 * Nudge the face's four corners so each of the nine cells sits on one sticker colour.
 * A small pull back toward the pose's own answer keeps it from sliding onto a neighbouring sticker.
 */
function snapQuad(cls: Uint8Array, W: number, H: number, quad: V2[]): V2[] {
  const size = Math.hypot(quad[2][0] - quad[0][0], quad[2][1] - quad[0][1])
  if (!(size > 6)) return quad
  const cost = (q: V2[]) => quadMismatch(cls, W, H, q) + (6 * q.reduce((s, c, i) => s + Math.hypot(c[0] - quad[i][0], c[1] - quad[i][1]), 0)) / size
  let q = quad.map((c) => [...c] as V2)
  let e = cost(q)
  for (let step = 0.05 * size; step > 0.004 * size; step *= 0.7) {
    let improved = true
    for (let guard = 0; improved && guard < 20; guard++) {
      improved = false
      for (let c = 0; c < 4; c++) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const t = q.map((p) => [...p] as V2)
          t[c][0] += dx * step
          t[c][1] += dy * step
          const et = cost(t)
          if (et < e) {
            q = t
            e = et
            improved = true
          }
        }
      }
    }
  }
  return q
}

export interface PoseFace {
  /** face of the *model*; which physical face this is gets decided from its centre colour */
  model: Face
  /** 1 = head-on, around 0.12 = steeply turned away */
  facing: number
  /** the nine colours, row-major as seen from outside */
  labs: Lab[]
  /** the same nine colours as measured, before any white balance */
  rgbs: Rgb[]
  /** cells that are a real sticker colour (not white, wall or skin): a plain-white "face" is just wall */
  colored: number
  /** which sticker colours (2 red, 3 orange, 4 yellow, 5 green, 6 blue) appear on this face */
  classes: number[]
  /** centre of each cell and the face outline, in picture pixels */
  centers: V2[]
  quad: V2[]
  /** how many of the 9 samples in the worst cell agreed on one colour (9 = perfectly clean) */
  purity: number
  /** every cell is one clean colour and nothing is missing */
  clean: boolean
}

/** Colours at every sticker of every face the pose sees well. `scale` maps pose pixels to `img` pixels. */
export function readFaces(img: Pixels, cls: Uint8Array, clsW: number, pose: Pose, scale: number, pre: Gains = NO_GAINS): PoseFace[] {
  const { data, width: W, height: H } = img
  const clsH = cls.length / clsW
  const m = make(pose, clsW, clsH)
  const out: PoseFace[] = []
  for (const fm of MODEL) {
    const fc = facing(m, fm)
    if (fc < MIN_FACING) continue
    const corner = (du: number, dv: number): V2 => {
      const c = fm.centers[4]
      return m.px(m.toCam([c[0] + fm.a[0] * du + fm.b[0] * dv, c[1] + fm.a[1] * du + fm.b[1] * dv, c[2] + fm.a[2] * du + fm.b[2] * dv]))
    }
    const quad = snapQuad(cls, clsW, clsH, [corner(-1.5, -1.5), corner(1.5, -1.5), corner(1.5, 1.5), corner(-1.5, 1.5)])
    const map = squareToQuad(quad)
    const labs: Lab[] = []
    const rgbs: Rgb[] = []
    const centers: V2[] = []
    let purity = 9
    let colored = 0
    const classes = new Set<number>()
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const [cx0, cy0] = map((i + 0.5) / 3, (j + 0.5) / 3)
        centers.push([cx0 * scale, cy0 * scale])
        const rs: number[] = []
        const gs: number[] = []
        const bs: number[] = []
        const counts = new Uint8Array(7)
        let n = 0
        for (const dv of [-0.3, -0.15, 0, 0.15, 0.3]) {
          for (const du of [-0.3, -0.15, 0, 0.15, 0.3]) {
            const [px, py] = map((i + 0.5 + du) / 3, (j + 0.5 + dv) / 3)
            const x = Math.round(px * scale)
            const y = Math.round(py * scale)
            if (x < 0 || y < 0 || x >= W || y >= H) continue
            const o = (y * W + x) * 4
            rs.push(data[o])
            gs.push(data[o + 1])
            bs.push(data[o + 2])
            const sx = Math.round(px)
            const sy = Math.round(py)
            counts[sx >= 0 && sy >= 0 && sx < clsW && sy < clsH ? cls[sy * clsW + sx] : 0]++
            n++
          }
        }
        let top = 1
        for (let k = 2; k <= 6; k++) if (counts[k] > counts[top]) top = k
        purity = Math.min(purity, n ? Math.round((counts[top] / 25) * 9) : 0)
        const med = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0)
        const rgb: Rgb = [Math.min(255, med(rs) * pre[0]), Math.min(255, med(gs) * pre[1]), Math.min(255, med(bs) * pre[2])]
        rgbs.push(rgb)
        labs.push(labFrom(rgb))
        const k = stickerClass(rgb[0], rgb[1], rgb[2], true)
        if (k >= 2) {
          colored++
          classes.add(k)
        }
      }
    }
    out.push({ model: fm.face, facing: fc, labs, rgbs, colored, classes: [...classes], centers, quad: quad.map((p) => [p[0] * scale, p[1] * scale] as V2), purity, clean: purity >= 6 && colored >= 2 })
  }
  return out
}

/**
 * Is this really a cube, and not a bright wall or a sheet of paper that happens to be box-shaped?
 * A cube always shows several different sticker colours, and plenty of its outline is coloured.
 */
export function looksLikeCube(faces: PoseFace[], strictCls: Uint8Array, mask: Uint8Array): boolean {
  const seen = faces.filter((f) => f.facing > 0.3)
  const colors = new Set(seen.flatMap((f) => f.classes))
  const colored = seen.reduce((n, f) => n + f.colored, 0)
  let patch = 0
  let chromatic = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    patch++
    if (strictCls[i] >= 2) chromatic++
  }
  const needColors = seen.length > 1 ? 3 : 2
  return colored >= 4 && colors.size >= needColors && patch > 0 && chromatic / patch >= 0.2
}

/** Colours at the middle of each of a face's nine cells, for any four-cornered outline (row-major, as seen from outside). */
export function sampleQuad(img: Pixels, quad: V2[]): { rgbs: Rgb[]; centers: V2[] } {
  const { data, width: W, height: H } = img
  const map = squareToQuad(quad)
  const rgbs: Rgb[] = []
  const centers: V2[] = []
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      centers.push(map((i + 0.5) / 3, (j + 0.5) / 3))
      const rs: number[] = []
      const gs: number[] = []
      const bs: number[] = []
      for (const dv of [-0.3, -0.15, 0, 0.15, 0.3]) {
        for (const du of [-0.3, -0.15, 0, 0.15, 0.3]) {
          const [px, py] = map((i + 0.5 + du) / 3, (j + 0.5 + dv) / 3)
          const x = Math.round(px)
          const y = Math.round(py)
          if (x < 0 || y < 0 || x >= W || y >= H) continue
          const o = (y * W + x) * 4
          rs.push(data[o])
          gs.push(data[o + 1])
          bs.push(data[o + 2])
        }
      }
      const med = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0)
      rgbs.push([med(rs), med(gs), med(bs)])
    }
  }
  return { rgbs, centers }
}

/** A corner view of a cube sitting in the middle of the picture: a starting layout to drag into place by hand. */
export function defaultFaces(W: number, H: number): V2[][] {
  const pose: Pose = { yaw: 40 * DEG, pitch: 32 * DEG, roll: 0, tx: 0, ty: 0, d: 5.2, f: 0.6 * Math.min(W, H) }
  const m = make(pose, W, H)
  return MODEL.filter((fm) => facing(m, fm) >= MIN_FACING).map((fm) => {
    const c = fm.centers[4]
    const at = (du: number, dv: number): V2 => m.px(m.toCam([c[0] + fm.a[0] * du + fm.b[0] * dv, c[1] + fm.a[1] * du + fm.b[1] * dv, c[2] + fm.a[2] * du + fm.b[2] * dv]))
    return [at(-1.5, -1.5), at(1.5, -1.5), at(1.5, 1.5), at(-1.5, 1.5)]
  })
}
