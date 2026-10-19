import type { Cube } from '../cube/cube'
import { stickerAt, type Vec3 } from '../cube/geometry'
import { COLOR_RGB } from './color'
import { STANDARD_SCHEME } from './session'
import { rotation, type Pose } from './pose'

/** Ray-cast a cube through a pinhole camera: a pure-software "photo" with known ground truth, for tests. */
export function renderCube(W: number, H: number, pose: Pose, cube: Cube, opts: { gap?: number; wall?: [number, number, number] } = {}) {
  const gap = opts.gap ?? 0.035
  const wall = opts.wall ?? [196, 188, 176]
  const R = rotation(pose)
  // model = R^T (cam - t), with t = (0,0,-d)
  const Rt = (v: number[]): number[] => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]]
  const o = Rt([0, 0, pose.d])
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ux = (x - W / 2 - pose.tx) / pose.f
      const uy = -(y - H / 2 - pose.ty) / pose.f
      const d = Rt([ux, uy, -1])
      // slab intersection with the box [-1.5, 1.5]^3
      let t0 = -Infinity
      let t1 = Infinity
      let axis = 0
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (Math.abs(o[a]) > 1.5) t1 = -Infinity
          continue
        }
        const ta = (-1.5 - o[a]) / d[a]
        const tb = (1.5 - o[a]) / d[a]
        const lo = Math.min(ta, tb)
        const hi = Math.max(ta, tb)
        if (lo > t0) {
          t0 = lo
          axis = a
        }
        t1 = Math.min(t1, hi)
      }
      let rgb: number[] = wall
      if (t0 < t1 && t0 > 0) {
        const p = [o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0]
        const normal: Vec3 = [0, 0, 0]
        normal[axis] = p[axis] > 0 ? 1 : -1
        const others = [0, 1, 2].filter((k) => k !== axis)
        const cell = others.map((k) => Math.min(2, Math.max(0, Math.floor(p[k] + 1.5))))
        const frac = others.map((k, i) => p[k] + 1.5 - cell[i])
        if (frac.some((f) => f < gap || f > 1 - gap)) rgb = [18, 18, 18]
        else {
          const pos: Vec3 = [0, 0, 0]
          pos[axis] = normal[axis]
          others.forEach((k, i) => (pos[k] = cell[i] - 1))
          rgb = COLOR_RGB[STANDARD_SCHEME[cube[stickerAt(pos, normal)]]]
        }
      }
      data.set([rgb[0], rgb[1], rgb[2], 255], (y * W + x) * 4)
    }
  }
  return { data, width: W, height: H }
}
