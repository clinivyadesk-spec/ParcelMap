export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Normalised progress of `frame` across [start, start + length). */
export function span(frame: number, start: number, length: number): number {
  if (length <= 0) return frame >= start ? 1 : 0
  return clamp01((frame - start) / length)
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t)
  return 1 - Math.pow(1 - x, 3)
}

export function easeOutQuad(t: number): number {
  const x = clamp01(t)
  return 1 - (1 - x) * (1 - x)
}

/**
 * Slight overshoot, used for markers dropping in. The endpoints are returned
 * exactly: the polynomial evaluates to -2.2e-16 at x=0, and a marker radius
 * or opacity driven from a negative "nothing yet" value is a nuisance.
 */
export function easeOutBack(t: number, overshoot = 1.7): number {
  const x = clamp01(t)
  if (x === 0) return 0
  if (x === 1) return 1
  const c3 = overshoot + 1
  return 1 + c3 * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
