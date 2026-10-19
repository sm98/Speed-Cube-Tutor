import { describe, expect, it } from 'vitest'
import { applyMoves, solvedCube } from '../cube/cube'
import { classMap } from './stickers'
import { cubeMask } from './cuboid'
import { fitCube, looksLikeCube, readFaces } from './cubefit'
import type { Pose } from './pose'
import { ScanSession } from './session'
import { renderCube } from './testutil'

const W = 200
const H = 150
const DEG = Math.PI / 180

function scanView(truth: ReturnType<typeof solvedCube>, pose: Pose, session: ScanSession) {
  const img = renderCube(W, H, pose, truth)
  const cls = classMap(img, true)
  const fit = fitCube(cls, cubeMask(classMap(img, true), W, H), W, H)
  expect(fit).not.toBeNull()
  const faces = readFaces(img, cls, W, fit!.pose, 1)
  let captured = 0
  for (const f of faces) {
    if (f.clean && session.check(f.labs).ok) {
      session.capture(f.labs)
      captured++
    }
  }
  return { fit: fit!, captured, faces }
}

describe('whole-cube reading from corner views', () => {
  const truth = applyMoves(solvedCube(), "R U R' U' F2 D L2 B' U2 F R' D2 L U'")
  const view1: Pose = { yaw: 40 * DEG, pitch: 32 * DEG, roll: 8 * DEG, tx: 4, ty: -3, d: 7, f: 0.9 * W }
  const view2: Pose = { yaw: 220 * DEG, pitch: -30 * DEG, roll: -6 * DEG, tx: -3, ty: 4, d: 6.5, f: 0.85 * W }

  it('reads three faces from one corner view, with perfect colours on a clean render', () => {
    const s = new ScanSession()
    const { captured, fit } = scanView(truth, view1, s)
    expect(fit.energy).toBeLessThan(3)
    expect(captured).toBe(3)
  })

  it('two opposite corner views rebuild the full cube', () => {
    const s = new ScanSession()
    scanView(truth, view1, s)
    scanView(truth, view2, s)
    expect(s.complete).toBe(true)
    const out = s.result()
    expect(out.cube).toEqual(truth)
    expect(out.oriented.valid).toBe(true)
  })

  it('also handles a single face held head-on', () => {
    const s = new ScanSession()
    const r = scanView(truth, { yaw: 0, pitch: 0, roll: 12 * DEG, tx: 0, ty: 0, d: 6.2, f: 0.9 * W }, s)
    expect(r.captured).toBeGreaterThanOrEqual(1)
  })
})

describe('not a cube', () => {
  it('rejects a bright cream wall that looks like a big white box', () => {
    // a wall patch with a cable and a plug on it, nothing colourful
    const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H }
    for (let i = 0; i < W * H; i++) img.data.set([238, 232, 212, 255], i * 4)
    for (let y = 40; y < 100; y++) for (let x = 20; x < 120; x++) img.data.set([225, 220, 200, 255], (y * W + x) * 4)
    const strict = classMap(img)
    const lenient = classMap(img, true)
    const mask = cubeMask(lenient, W, H)
    const fit = fitCube(lenient, mask, W, H)
    if (fit) expect(looksLikeCube(readFaces(img, lenient, W, fit.pose, 1), lenient, mask)).toBe(false)
  })

  it('accepts a real cube', () => {
    const truth = applyMoves(solvedCube(), "R U R' U' F2 D L2 B' U2 F R' D2 L U'")
    const img = renderCube(W, H, { yaw: 40 * DEG, pitch: 32 * DEG, roll: 8 * DEG, tx: 4, ty: -3, d: 7, f: 0.9 * W }, truth)
    const strict = classMap(img)
    const lenient = classMap(img, true)
    const mask = cubeMask(lenient, W, H)
    const fit = fitCube(lenient, mask, W, H)!
    expect(looksLikeCube(readFaces(img, lenient, W, fit.pose, 1), lenient, mask)).toBe(true)
  })
})
