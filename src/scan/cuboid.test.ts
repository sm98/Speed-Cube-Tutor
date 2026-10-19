import { describe, expect, it } from 'vitest'
import { boxOf, cubeMask, fitBox, hullOf } from './cuboid'
import { classMap } from './stickers'
import type { Pose } from './pose'

describe('fitBox with no cube in view', () => {
  it('finds nothing', () => {
    const W = 200, H = 150
    const none = new Uint8Array(W * H)
    expect(fitBox(cubeMask(none, W, H), W, H)).toBeNull()
  })
})

describe('fitBox on a synthetic silhouette', () => {
  it('recovers the outline of a known pose', () => {
    const W = 200, H = 150
    const truth: Pose = { yaw: 0.6, pitch: -0.5, roll: 0.3, tx: 6, ty: -4, d: 5, f: 170 }
    const hull = boxOf(truth, W, H).verts
    // fill the silhouette: every pixel inside the convex hull of the projected corners
    const cls = new Uint8Array(W * H)
    const poly = hullOf(hull)
    const inside = (x: number, y: number) =>
      poly.every((a, i) => {
        const b = poly[(i + 1) % poly.length]
        return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0
      })
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) cls[y * W + x] = (x >> 3) % 2 ? 3 : 6
    const fit = fitBox(cubeMask(cls, W, H), W, H)
    expect(fit!.error).toBeLessThan(0.12)
  })
})
