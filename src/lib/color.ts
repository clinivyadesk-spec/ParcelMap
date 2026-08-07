export interface Rgb {
  r: number
  g: number
  b: number
}

const HEX_SHORT = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_LONG = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

export function parseHex(hex: string): Rgb {
  const short = HEX_SHORT.exec(hex)
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    }
  }
  const long = HEX_LONG.exec(hex)
  if (long) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
    }
  }
  return { r: 249, g: 115, b: 22 }
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

/** Mix towards white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex)
  const target = amount >= 0 ? 255 : 0
  const t = Math.abs(amount)
  const mix = (c: number) => Math.round(c + (target - c) * t)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

/** Perceived luminance, 0..1. Used to pick readable text on a coloured chip. */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
