/** A pinhole-camera pose for the 3x3x3 cube (3 units wide, centred on the origin). */

type V3 = [number, number, number]
type V2 = [number, number]

export interface Pose {
  yaw: number
  pitch: number
  roll: number
  /** shift of the cube's middle from the picture's middle, in pixels */
  tx: number
  ty: number
  /** distance from the camera to the cube's centre, in model units (the cube is 3 wide) */
  d: number
  /** focal length in pixels */
  f: number
}

export function rotation(p: Pose): number[] {
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw)
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch)
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll)
  // R = Rz(roll) * Rx(pitch) * Ry(yaw)
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp]
  const rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1]
  const mul = (A: number[], B: number[]) => {
    const out = new Array(9).fill(0)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]
    return out
  }
  return mul(rz, mul(rx, ry))
}

/** Projection helpers for a pose; the cube sits in front of the camera along -z. */
export function make(pose: Pose, W: number, H: number) {
  const R = rotation(pose)
  const t: V3 = [0, 0, -pose.d]
  const toCam = (v: V3): V3 => [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + t[0],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + t[1],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + t[2],
  ]
  const px = (c: V3): V2 => [W / 2 + pose.tx + (pose.f * c[0]) / -c[2], H / 2 + pose.ty - (pose.f * c[1]) / -c[2]]
  const dir = (n: V3): V3 => [R[0] * n[0] + R[1] * n[1] + R[2] * n[2], R[3] * n[0] + R[4] * n[1] + R[5] * n[2], R[6] * n[0] + R[7] * n[1] + R[8] * n[2]]
  return { toCam, px, dir }
}

import { FACES, STICKERS, type Face } from '../cube/geometry'

export interface FaceModel {
  face: Face
  /** outward normal */
  n: V3
  /** step along one column / one row of this face (the face's own net orientation) */
  a: V3
  b: V3
  /** the 9 sticker centres on the cube's surface, row-major */
  centers: V3[]
}

const diff = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]

export const MODEL: FaceModel[] = FACES.map((face, fi) => {
  const s = STICKERS.slice(fi * 9, fi * 9 + 9)
  const n = s[0].normal as V3
  return {
    face,
    n,
    a: diff(s[1].pos as V3, s[0].pos as V3),
    b: diff(s[3].pos as V3, s[0].pos as V3),
    centers: s.map((k) => [k.pos[0] + 0.5 * n[0], k.pos[1] + 0.5 * n[1], k.pos[2] + 0.5 * n[2]] as V3),
  }
})

/** How squarely a face looks at the camera: 1 = head-on, 0 = edge-on, negative = facing away. */
export function facing(m: ReturnType<typeof make>, fm: FaceModel): number {
  const c = m.toCam([fm.n[0] * 1.5, fm.n[1] * 1.5, fm.n[2] * 1.5])
  const n = m.dir(fm.n)
  return -(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]) / Math.hypot(c[0], c[1], c[2])
}
