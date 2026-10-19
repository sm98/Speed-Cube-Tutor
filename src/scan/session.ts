import { FACES, type Face } from '../cube/geometry'
import { classifyCube, labDist as dist, nearestName, type Classification, type ColorName, type Lab } from './color'
import { resolveOrientation, type Oriented } from './orient'

/** Standard colour scheme: white up, green front. A face is recognised by its centre sticker. */
export const STANDARD_SCHEME: Record<Face, ColorName> = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' }
const FACE_OF_COLOR = Object.fromEntries(FACES.map((f) => [STANDARD_SCHEME[f], f])) as Record<ColorName, Face>

export interface ScanResult extends Classification {
  oriented: Oriented
}

/**
 * Which face is which, from the six centre colours alone, without trusting any absolute colour.
 * Lighting shifts every colour together but never reorders them: white is the least colourful centre,
 * and the other five run red, orange, yellow, green, blue in order of hue.
 */
export function assignFaces(centers: Lab[]): Face[] {
  const chroma = (l: Lab) => Math.hypot(l[1], l[2])
  const white = centers.reduce((best, l, i) => (chroma(l) - 0.2 * l[0] < chroma(centers[best]) - 0.2 * centers[best][0] ? i : best), 0)
  // Lab hue angle, with the cut placed where no sticker colour sits (between blue and a crimson red)
  const hue = (l: Lab) => ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360 + 30) % 360
  const rest = centers.map((_, i) => i).filter((i) => i !== white).sort((x, y) => hue(centers[x]) - hue(centers[y]))
  const order: Face[] = ['R', 'L', 'D', 'F', 'B']
  const out = new Array<Face>(centers.length)
  out[white] = 'U'
  rest.forEach((i, k) => (out[i] = order[k]))
  return out
}

/** Centres closer than this are treated as "the same face again". */
const SAME_FACE = 14

export class ScanSession {
  /** nine colours per face, in the order the faces were captured */
  readonly captures: Lab[][] = []

  get complete(): boolean {
    return this.captures.length === 6
  }

  /** A guess from absolute colour, good enough to place a preview before all six faces are known. */
  provisionalFace(labs: Lab[]): Face {
    return FACE_OF_COLOR[nearestName(labs[4]).name]
  }

  /** The captured face whose centre matches this one, if any. */
  matching(labs: Lab[]): number {
    return this.captures.findIndex((c) => dist(c[4], labs[4]) < SAME_FACE)
  }

  /** Is this reading a plausible new face? */
  check(labs: Lab[]): { ok: true } | { ok: false; reason: string } {
    if (this.matching(labs) >= 0) return { ok: false, reason: 'Already have that face. Turn the cube to show a new one.' }
    // each sticker should look like *some* sticker colour, otherwise we're probably looking at a wall or a hand
    const worst = Math.max(...labs.map((l) => nearestName(l).dist))
    if (worst > 60) return { ok: false, reason: 'Line the cube face up inside the square.' }
    return { ok: true }
  }

  /** Returns the slot (0-5) the face was stored in. */
  capture(labs: Lab[]): number {
    this.captures.push(labs)
    return this.captures.length - 1
  }

  retake(slot: number): void {
    this.captures.splice(slot, 1)
  }

  reset(): void {
    this.captures.length = 0
  }

  result(): ScanResult {
    if (!this.complete) throw new Error('scan incomplete')
    const faces = assignFaces(this.captures.map((c) => c[4]))
    const byFace = {} as Record<Face, Lab[]>
    faces.forEach((f, i) => (byFace[f] = this.captures[i]))
    const classified = classifyCube(byFace)
    const oriented = resolveOrientation(classified.cube, classified.uncertain)
    return { ...classified, scheme: STANDARD_SCHEME, cube: oriented.cube, uncertain: oriented.uncertain, oriented }
  }
}

/**
 * Decides when to capture, keyed on the centre sticker (it never moves relative to its face).
 * Once the centre colour has held steady for a moment, the face is captured using the
 * per-sticker median of the recent frames, so a little shake or glare doesn't matter.
 * After a capture it stays disarmed until the centre colour changes, i.e. the user moved on.
 */
export class StabilityGate {
  private frames: Lab[][] = []
  private since = 0
  private lastCenter: Lab | null = null

  constructor(
    private readonly dwellMs = 450,
    private readonly centerTolerance = 10,
    private readonly stickerTolerance = 16,
  ) {}

  /** progress 0..1; reaches 1 when it is time to capture */
  push(labs: Lab[], now: number): number {
    const center = labs[4]
    if (this.lastCenter) {
      if (dist(center, this.lastCenter) < 14) return 0
      this.lastCenter = null
    }
    const first = this.frames[0]
    const shifted = first && labs.some((l, i) => dist(l, first[i]) > (i === 4 ? this.centerTolerance : this.stickerTolerance))
    if (!first || shifted) {
      this.frames = [labs]
      this.since = now
      return 0
    }
    this.frames.push(labs)
    if (this.frames.length > 8) this.frames.shift()
    return Math.min(1, (now - this.since) / this.dwellMs)
  }

  /** Per-sticker median of the recent frames: the reading to capture. */
  reading(): Lab[] {
    return Array.from({ length: 9 }, (_, i) => {
      const med = (k: number) => {
        const v = this.frames.map((f) => f[i][k]).sort((a, b) => a - b)
        return v[v.length >> 1]
      }
      return [med(0), med(1), med(2)] as Lab
    })
  }

  markCaptured(labs: Lab[]): void {
    this.lastCenter = labs[4]
    this.frames = []
  }

  reset(): void {
    this.frames = []
    this.lastCenter = null
  }
}
