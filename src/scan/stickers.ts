/**
 * Which sticker colour each pixel looks like. Stickers are painted in six strong colours, so a
 * pixel is either "sticker colour X" or "not a sticker" (wall, skin, shadow).
 */

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

/**
 * 0 = not a sticker pixel, else 1 white, 2 red, 3 orange, 4 yellow, 5 green, 6 blue.
 *
 * `lenient` also accepts shadowed stickers. The strict version is for finding the cube against a wall
 * and a hand (a bright wall must not look like white stickers); once the cube is located, the lenient
 * version is used inside it, where dim white or orange sticker faces still need a class.
 */
export function stickerClass(r: number, g: number, b: number, lenient = false): number {
  const v = Math.max(r, g, b)
  if (v < (lenient ? 45 : 60)) return 0 // black plastic / deep shadow
  const mn = Math.min(r, g, b)
  const s = (v - mn) / v
  if (s < 0.28) return v >= (lenient ? 140 : 215) ? 1 : 0 // white sticker; greys and beige walls are darker
  if (s < (lenient ? 0.34 : 0.42)) return 0 // skin, wood, dull stuff
  const d = v - mn
  let hue = 0
  if (v === r) hue = (((g - b) / d) * 60 + 360) % 360
  else if (v === g) hue = ((b - r) / d) * 60 + 120
  else hue = ((r - g) / d) * 60 + 240
  // red and orange sit right next to skin tones; skin is far less saturated than any sticker
  if (hue < 13 || hue >= 335) return s >= 0.6 && v >= (lenient ? 90 : 120) ? 2 : 0
  if (hue < 38) return s >= 0.6 && v >= (lenient ? 130 : 190) ? 3 : 0 // dull orange/brown is usually skin
  if (hue < 95) return v >= (lenient ? 100 : 140) ? 4 : 0
  if (hue < 175) return v >= (lenient ? 55 : 80) ? 5 : 0
  if (hue < 265) return v >= (lenient ? 45 : 70) ? 6 : 0
  return 0
}

export function classMap(img: Pixels, lenient = false): Uint8Array {
  const { data, width: W, height: H } = img
  const out = new Uint8Array(W * H)
  for (let i = 0, p = 0; i < W * H; i++, p += 4) out[i] = stickerClass(data[p], data[p + 1], data[p + 2], lenient)
  return out
}
