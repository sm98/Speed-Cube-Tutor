import { make, type Pose } from './pose'

/**
 * Draws a 3D box on the cube in the picture. Only the cube's silhouette is used:
 * every sticker-coloured pixel, joined into one patch. We search for the box pose
 * (position, orientation, distance) whose outline best matches that patch.
 */

type V2 = [number, number]
type V3 = [number, number, number]

const DEG = Math.PI / 180

/**
 * The cube's silhouette. A cube is the one place in the picture where several different sticker hues sit
 * side by side; a wall, a hand or a shirt is one flat colour. So a pixel counts as cube when it is
 * itself sticker-coloured and its neighbourhood holds at least two of the four hue families (red/orange,
 * yellow, green, blue). Those pixels are closed into one patch and filled to their convex outline (a cube
 * is convex), which also covers the white stickers. White is deliberately not used: a bright wall is
 * indistinguishable from it. 1 = cube.
 */
export function cubeMask(cls: Uint8Array, W: number, H: number): Uint8Array {
  const N = W * H
  const family = (k: number) => (k === 2 || k === 3 ? 0 : k === 4 ? 1 : k === 5 ? 2 : k === 6 ? 3 : -1)

  // per-family integral images: how many pixels of each hue family lie in a window
  const stride = W + 1
  const integral = Array.from({ length: 4 }, () => new Int32Array(stride * (H + 1)))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = family(cls[y * W + x])
      for (let k = 0; k < 4; k++) {
        const t = integral[k]
        t[(y + 1) * stride + x + 1] = t[y * stride + x + 1] + t[(y + 1) * stride + x] - t[y * stride + x] + (f === k ? 1 : 0)
      }
    }
  }
  const r = Math.max(4, Math.round(0.11 * Math.min(W, H)))
  const need = Math.max(5, Math.round(0.006 * (2 * r + 1) ** 2))
  const fg = new Uint8Array(N)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (family(cls[y * W + x]) < 0) continue
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1)
      let families = 0
      for (let k = 0; k < 4 && families < 2; k++) {
        const t = integral[k]
        if (t[y1 * stride + x1] - t[y0 * stride + x1] - t[y1 * stride + x0] + t[y0 * stride + x0] >= need) families++
      }
      if (families >= 2) fg[y * W + x] = 1
    }
  }

  const rc = Math.max(2, Math.round(0.03 * Math.min(W, H)))
  const box = (src: Uint8Array, want: number): Uint8Array => {
    // separable box filter: a pixel turns on (dilate) / stays on only if the whole window is on (erode)
    const tmp = new Uint8Array(N)
    const out = new Uint8Array(N)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let hit = want ? 0 : 1
        for (let k = Math.max(0, x - rc); k <= Math.min(W - 1, x + rc); k++) {
          if (want ? src[y * W + k] : !src[y * W + k]) {
            hit = want ? 1 : 0
            break
          }
        }
        tmp[y * W + x] = hit
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let hit = want ? 0 : 1
        for (let k = Math.max(0, y - rc); k <= Math.min(H - 1, y + rc); k++) {
          if (want ? tmp[k * W + x] : !tmp[k * W + x]) {
            hit = want ? 1 : 0
            break
          }
        }
        out[y * W + x] = hit
      }
    }
    return out
  }
  const closed = box(box(fg, 1), 0)

  // keep only the biggest connected patch
  const seen = new Uint8Array(N)
  let best: number[] = []
  const stack: number[] = []
  for (let i0 = 0; i0 < N; i0++) {
    if (!closed[i0] || seen[i0]) continue
    const comp: number[] = []
    stack.push(i0)
    seen[i0] = 1
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      const x = i % W
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1]) {
        if (j >= 0 && closed[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    if (comp.length > best.length) best = comp
  }
  const out = new Uint8Array(N)
  if (best.length < 40) return out

  // fill to the convex outline
  const pts: V2[] = best.filter((_, k) => k % 3 === 0).map((i) => [i % W, Math.floor(i / W)])
  const hull = hullOf(pts)
  if (hull.length < 3) return out
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let inside = true
      for (let k = 0; k < hull.length && inside; k++) {
        const a = hull[k]
        const b = hull[(k + 1) % hull.length]
        if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) inside = false
      }
      if (inside) out[y * W + x] = 1
    }
  }
  return out
}

const CORNERS: V3[] = [
  [-1.5, -1.5, -1.5], [1.5, -1.5, -1.5], [1.5, 1.5, -1.5], [-1.5, 1.5, -1.5],
  [-1.5, -1.5, 1.5], [1.5, -1.5, 1.5], [1.5, 1.5, 1.5], [-1.5, 1.5, 1.5],
]
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
]
// each face = its 4 corners and outward normal
const FACES: { c: number[]; n: V3 }[] = [
  { c: [4, 5, 6, 7], n: [0, 0, 1] }, { c: [0, 1, 2, 3], n: [0, 0, -1] },
  { c: [1, 5, 6, 2], n: [1, 0, 0] }, { c: [0, 4, 7, 3], n: [-1, 0, 0] },
  { c: [3, 2, 6, 7], n: [0, 1, 0] }, { c: [0, 1, 5, 4], n: [0, -1, 0] },
]

export interface Box {
  /** the 8 corners in the picture */
  verts: V2[]
  /** 12 edges; `front` is true when the edge borders a face that points at the camera */
  edges: { a: V2; b: V2; front: boolean }[]
}

export function boxOf(pose: Pose, W: number, H: number): Box {
  const m = make(pose, W, H)
  const cam = CORNERS.map((c) => m.toCam(c))
  const verts = cam.map((c) => m.px(c))
  const facing = FACES.map((f) => {
    const mid = m.toCam([f.n[0] * 1.5, f.n[1] * 1.5, f.n[2] * 1.5])
    const n = m.dir(f.n)
    return -(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]) > 0
  })
  const edgeFront = (a: number, b: number) =>
    FACES.some((f, i) => facing[i] && f.c.includes(a) && f.c.includes(b))
  return { verts, edges: EDGES.map(([a, b]) => ({ a: verts[a], b: verts[b], front: edgeFront(a, b) })) }
}

export function hullOf(pts: V2[]): V2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cr = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: V2[] = []
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: V2[] = []
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

export interface Probe {
  mask: Uint8Array
  W: number
  H: number
  pts: number[] // sample pixel indices
  total: number // mask samples
  cx: number
  cy: number
}

export function probeOf(mask: Uint8Array, W: number, H: number): Probe | null {
  const stride = Math.max(2, Math.round(W / 70))
  const pts: number[] = []
  let total = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < H; y += stride) {
    for (let x = 0; x < W; x += stride) {
      pts.push(y * W + x)
      if (mask[y * W + x]) {
        total++
        sx += x
        sy += y
      }
    }
  }
  if (total < 40) return null
  return { mask, W, H, pts, total, cx: sx / total, cy: sy / total }
}

/** Fraction of the picture where the box outline and the cube patch disagree (0 = identical). */
export function mismatch(pr: Probe, pose: Pose): number {
  const m = make(pose, pr.W, pr.H)
  const hull = hullOf(CORNERS.map((c) => m.px(m.toCam(c))))
  if (hull.length < 3) return Infinity
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [x, y] of hull) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  let wrong = 0
  for (const i of pr.pts) {
    const x = i % pr.W
    const y = (i - x) / pr.W
    const inMask = pr.mask[i] === 1
    let inBox = false
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
      inBox = true
      for (let k = 0; k < hull.length; k++) {
        const a = hull[k]
        const b = hull[(k + 1) % hull.length]
        if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) {
          inBox = false
          break
        }
      }
    }
    if (inMask !== inBox) wrong++
  }
  return wrong / pr.total
}

export interface BoxFit {
  pose: Pose
  /** share of the cube patch the outline gets wrong; below ~0.25 is a good fit */
  error: number
}

export interface FitOptions {
  /** how many of the best coarse poses to refine */
  top?: number
}

/**
 * With `hint` (last frame's pose) only a quick local refinement runs, which is what follows the cube
 * as it moves. Without it, a coarse sweep over every orientation finds the cube from scratch.
 */
export function fitBox(mask: Uint8Array, W: number, H: number, hint?: Pose | null, opts: FitOptions = {}): BoxFit | null {
  return fitBoxAll(mask, W, H, hint, opts)[0] ?? null
}

/** Every refined candidate, best first (different box poses can explain a silhouette almost equally well). */
export function fitBoxAll(mask: Uint8Array, W: number, H: number, hint?: Pose | null, opts: FitOptions = {}): BoxFit[] {
  const pr = probeOf(mask, W, H)
  if (!pr) return []
  const seeds: { pose: Pose; e: number }[] = []
  const add = (pose: Pose) => {
    const e = mismatch(pr, pose)
    if (isFinite(e)) seeds.push({ pose, e })
  }
  if (hint) add(hint)
  else {
    const f = 0.85 * W
    for (const d of [3.6, 4.6, 6, 8, 11]) {
      for (let yaw = 0; yaw < 90; yaw += 15) {
        for (let pitch = -75; pitch <= 75; pitch += 15) {
          for (let roll = 0; roll < 90; roll += 22.5) {
            add({ yaw: yaw * DEG, pitch: pitch * DEG, roll: roll * DEG, tx: pr.cx - W / 2, ty: pr.cy - H / 2, d, f })
          }
        }
      }
    }
  }
  if (!seeds.length) return []
  seeds.sort((a, b) => a.e - b.e)

  const clampF = (v: number) => Math.min(1.6 * W, Math.max(0.45 * W, v))
  const out: BoxFit[] = []
  for (const seed of seeds.slice(0, hint ? 1 : (opts.top ?? 6))) {
    let p = seed.pose
    let e = seed.e
    for (let k = hint ? 0.35 : 1; k > 0.03; k *= 0.7) {
      let improved = true
      for (let guard = 0; improved && guard < 25; guard++) {
        improved = false
        const moves: Pose[] = []
        for (const dir of [-1, 1]) {
          moves.push(
            { ...p, yaw: p.yaw + dir * k * 8 * DEG }, { ...p, pitch: p.pitch + dir * k * 8 * DEG },
            { ...p, roll: p.roll + dir * k * 8 * DEG }, { ...p, tx: p.tx + dir * k * 0.05 * W },
            { ...p, ty: p.ty + dir * k * 0.05 * W }, { ...p, d: Math.max(2.4, p.d + dir * k * 0.5) },
            { ...p, f: clampF(p.f + dir * k * 0.08 * W) },
          )
        }
        for (const q of moves) {
          const eq = mismatch(pr, q)
          if (eq < e) {
            p = q
            e = eq
            improved = true
          }
        }
      }
    }
    out.push({ pose: p, error: e })
  }
  return out.sort((a, b) => a.error - b.error)
}
