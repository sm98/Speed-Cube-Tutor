import { describe, expect, it } from 'vitest'
import { applyMoves, solvedCube } from '../cube/cube'
import { readStill } from './analyse'
import { labFrom, nearestName, NO_GAINS } from './color'
import { defaultFaces, sampleQuad } from './cubefit'
import type { Pose } from './pose'
import { ScanSession } from './session'
import { renderCube } from './testutil'

const DEG = Math.PI / 180

describe('readStill on synthetic photos, with the cube small in a big frame', () => {
  const truth = applyMoves(solvedCube(), "R U R' U' F2 D L2 B' U2 F R' D2 L U'")
  const W = 960
  const H = 720
  // far away: the cube covers roughly a quarter of the picture
  const view1: Pose = { yaw: 40 * DEG, pitch: 32 * DEG, roll: 8 * DEG, tx: 90, ty: -40, d: 15, f: 0.9 * W }
  const view2: Pose = { yaw: 220 * DEG, pitch: -30 * DEG, roll: -6 * DEG, tx: -80, ty: 50, d: 14, f: 0.85 * W }

  it('two opposite-corner photos rebuild the whole cube', () => {
    const s = new ScanSession()
    for (const pose of [view1, view2]) {
      const reading = readStill(renderCube(W, H, pose, truth))
      expect(reading).not.toBeNull()
      for (const f of reading!.faces) if (f.clean && s.check(f.labs).ok) s.capture(f.labs)
    }
    expect(s.complete).toBe(true)
    const out = s.result()
    expect(out.cube).toEqual(truth)
    expect(out.oriented.valid).toBe(true)
  }, 120000)

  it('maps the box and faces back into the full picture', () => {
    const reading = readStill(renderCube(W, H, view1, truth))!
    for (const [x, y] of reading.box.verts) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(W)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(H)
    }
  }, 120000)
})

describe('readStill on scenes with no cube, and in awkward light', () => {
  it('finds nothing in a bright cream wall with a cable on it', () => {
    const W = 480
    const H = 360
    const data = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) data.set([238, 232, 212, 255], i * 4)
    for (let y = 150; y < 170; y++) for (let x = 0; x < W; x++) data.set([60, 60, 62, 255], (y * W + x) * 4) // a dark cable
    expect(readStill({ data, width: W, height: H })).toBeNull()
  })

  it('still reads a cube in dim, warm room light', () => {
    const truth = applyMoves(solvedCube(), "R U R' U' F2 D L2 B' U2 F R' D2 L U'")
    const img = renderCube(480, 360, { yaw: 40 * DEG, pitch: 32 * DEG, roll: 8 * DEG, tx: 10, ty: -6, d: 7, f: 0.9 * 480 }, truth)
    const tint = [0.85, 0.72, 0.55] // a warm lamp, a bit dim
    for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) img.data[i + k] = img.data[i + k] * tint[k]
    const reading = readStill(img)
    expect(reading).not.toBeNull()
    expect(reading!.faces.filter((f) => f.clean).length).toBeGreaterThanOrEqual(2)
  })
})

describe('sampleQuad and defaultFaces (for fixing a grid by hand)', () => {
  const truth = applyMoves(solvedCube(), "R U R' U' F2 D L2 B' U2 F R' D2 L U'")
  const W = 480
  const H = 360
  const pose: Pose = { yaw: 40 * DEG, pitch: 32 * DEG, roll: 8 * DEG, tx: 10, ty: -6, d: 7, f: 0.9 * W }

  it('re-reads exactly the colours the automatic reading found, from the same outline', () => {
    const img = renderCube(W, H, pose, truth)
    const reading = readStill(img)!
    for (const f of reading.faces.filter((q) => q.clean)) {
      // the automatic reading corrects the lamp's colour cast first; the hand-fix path starts from the raw picture,
      // so compare which colour each cell is, not the raw numbers
      const again = sampleQuad(img, f.quad)
      f.labs.forEach((l, i) => expect(nearestName(labFrom(again.rgbs[i], NO_GAINS)).name).toBe(nearestName(l).name))
    }
  })

  it('reads different colours when the outline is dragged elsewhere', () => {
    const img = renderCube(W, H, pose, truth)
    const f = readStill(img)!.faces.find((q) => q.clean)!
    const moved = sampleQuad(img, f.quad.map(([x, y]) => [x + 40, y + 25] as [number, number]))
    expect(moved.rgbs).not.toEqual(f.rgbs)
  })

  it('offers three faces to start from, all inside the picture', () => {
    const faces = defaultFaces(W, H)
    expect(faces.length).toBe(3)
    for (const q of faces) for (const [x, y] of q) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(W)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(H)
    }
  })
})
