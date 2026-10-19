import { freshState, readCube, readStill, type CubeReading, type TrackState } from './analyse'

export type { CubeReading } from './analyse'

/** Reads a canvas: follows the cube from frame to frame in live video, or analyses a still photo carefully. */
export class CubeTracker {
  private state: TrackState = freshState()

  reset(): void {
    this.state = freshState()
  }

  /** One frame of live video. */
  follow(frame: HTMLCanvasElement, now: number): CubeReading | null {
    return readCube(pixels(frame), this.state, now)
  }

  /** A still photo: slower and more careful. */
  still(frame: HTMLCanvasElement): CubeReading | null {
    return readStill(pixels(frame))
  }
}

function pixels(c: HTMLCanvasElement) {
  return c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height)
}
