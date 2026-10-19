import { applyGains, estimateGains, labFrom, NO_GAINS, whitePatchGains, type Gains } from './color'
import { boxOf, cubeMask, type Box } from './cuboid'
import { fitCube, looksLikeCube, readFaces, type PoseFace } from './cubefit'
import type { Pose } from './pose'
import { classMap, type Pixels } from './stickers'

/** A pose is trusted below this; typical good fits score under 3, wrong ones above 8. */
const GOOD_ENERGY = 7
/** Below this the pose sits right on the stickers; above it, keep looking for a better one. */
const CLEAN_ENERGY = 2.5

export interface CubeReading {
  /** the 3D box over the cube, in the input picture's pixels */
  box: Box
  /** each visible face in the input picture's pixels; `clean` ones have nine clear sticker colours */
  faces: PoseFace[]
  energy: number
}

/** What carries over from one video frame to the next. */
export interface TrackState {
  pose: Pose | null
  gains: Gains
  lastSearch: number
}
export const freshState = (): TrackState => ({ pose: null, gains: NO_GAINS, lastSearch: -1e9 })

/** Shrink to `width` by averaging, so thin gaps and sticker edges survive. */
export function downscale(img: Pixels, width: number): Pixels {
  if (width >= img.width) return img
  const k = img.width / width
  const height = Math.max(1, Math.round(img.height / k))
  const data = new Uint8ClampedArray(width * height * 4)
  const ky = img.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * ky)
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * ky)))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * k)
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * k)))
      let r = 0, g = 0, b = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * img.width + xx) * 4
          r += img.data[o]
          g += img.data[o + 1]
          b += img.data[o + 2]
          n++
        }
      }
      const o = (y * width + x) * 4
      data[o] = r / n
      data[o + 1] = g / n
      data[o + 2] = b / n
      data[o + 3] = 255
    }
  }
  return { data, width, height }
}

export interface ReadOptions {
  workWidth?: number
  candidates?: number
  /** force a from-scratch search (a still photo) */
  search?: boolean
}

/**
 * Find the cube in one picture and read every visible sticker. Video frames pass the same `state` each
 * time so the pose is followed cheaply from frame to frame; a still photo passes `search: true`.
 */
export function readCube(img: Pixels, state: TrackState, now: number, opts: ReadOptions = {}): CubeReading | null {
  const workW = opts.workWidth ?? 200
  const raw = downscale(img, workW)
  // undo the lamp's colour cast first, so the class thresholds see the colours they were built for
  const pre = whitePatchGains(raw.data, raw.width * raw.height)
  const small = applyGains(raw, pre)
  const scale = img.width / small.width
  const cells = classMap(small, true)
  const mask = cubeMask(cells, small.width, small.height)

  let fit = !opts.search && state.pose ? fitCube(cells, mask, small.width, small.height, state.pose) : null
  // Following the last pose is cheap but can latch onto a wrong one (the cube was swapped or flipped),
  // so look from scratch now and then, and quickly whenever the current pose isn't a clean fit.
  const wait = !fit || fit.energy > GOOD_ENERGY ? 400 : fit.energy > CLEAN_ENERGY ? 600 : 1500
  if (opts.search || now - state.lastSearch > wait) {
    state.lastSearch = now
    const fresh = fitCube(cells, mask, small.width, small.height, null, opts.candidates ?? 4)
    if (fresh && (!fit || fresh.energy < fit.energy)) fit = fresh
  }
  if (!fit || fit.energy > GOOD_ENERGY) {
    state.pose = null
    return null
  }
  state.pose = fit.pose

  const faces = readFaces(img, cells, small.width, fit.pose, scale, pre)
  if (!looksLikeCube(faces, cells, mask)) {
    state.pose = null // a wall or a page, not a cube
    return null
  }
  // white-balance from the whitest sticker on the faces we can read, then recompute the colours
  state.gains = estimateGains(faces.filter((f) => f.clean).flatMap((f) => f.rgbs), state.gains)
  for (const f of faces) f.labs = f.rgbs.map((c) => labFrom(c, state.gains))

  const up = (p: [number, number]): [number, number] => [p[0] * scale, p[1] * scale]
  const b = boxOf(fit.pose, small.width, small.height)
  const box: Box = { verts: b.verts.map(up), edges: b.edges.map((e) => ({ ...e, a: up(e.a), b: up(e.b) })) }
  return { box, faces, energy: fit.energy }
}

function crop(img: Pixels, x0: number, y0: number, w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4)
  return { data, width: w, height: h }
}

/**
 * A still photo, analysed carefully. Pass 1 finds where the cube is; pass 2 cuts the picture down to
 * just the cube and reads it again at full detail, so a cube that fills a quarter of the frame still
 * gets its stickers read from plenty of pixels.
 */
export function readStill(img: Pixels): CubeReading | null {
  const raw = downscale(img, 200)
  const small = applyGains(raw, whitePatchGains(raw.data, raw.width * raw.height))
  const scale = img.width / small.width
  const mask = cubeMask(classMap(small, true), small.width, small.height)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const x = i % small.width
    const y = Math.floor(i / small.width)
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  if (x1 < x0) return null

  // a square-ish window with some room around the cube
  const side = Math.max(x1 - x0, y1 - y0) * 1.35 + 6
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const sx = Math.max(0, Math.round((cx - side / 2) * scale))
  const sy = Math.max(0, Math.round((cy - side / 2) * scale))
  const sw = Math.min(img.width - sx, Math.round(side * scale))
  const sh = Math.min(img.height - sy, Math.round(side * scale))
  const zoom = sw < 0.8 * img.width || sh < 0.8 * img.height
  const base = zoom ? crop(img, sx, sy, sw, sh) : img

  const r = readCube(base, freshState(), 0, { workWidth: 320, candidates: 8, search: true })
  if (!r || !zoom) return r
  // report everything in the original picture's coordinates
  const move = (p: [number, number]): [number, number] => [p[0] + sx, p[1] + sy]
  return {
    energy: r.energy,
    box: { verts: r.box.verts.map(move), edges: r.box.edges.map((e) => ({ ...e, a: move(e.a), b: move(e.b) })) },
    faces: r.faces.map((f) => ({ ...f, centers: f.centers.map(move), quad: f.quad.map(move) })),
  }
}
