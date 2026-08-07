import { point } from '@turf/helpers'
import distance from '@turf/distance'
import type { Place } from './types.ts'

export type Vec2 = [number, number]
/** `[lng, lat]`, GeoJSON order. */
export type LngLatTuple = [number, number]

/** Web Mercator is undefined at the poles; this is the standard cutoff. */
const MAX_LAT = 85.051129

/**
 * Project to normalised Web Mercator (0..1 on both axes, y increasing south).
 * Arcs are built in this space rather than as great circles: over a few
 * hundred kilometres a great circle is visually a straight line, which is
 * exactly the look we're trying to avoid.
 */
export function projectMercator(lng: number, lat: number): Vec2 {
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  const rad = (clampedLat * Math.PI) / 180
  const x = (lng + 180) / 360
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2
  return [x, y]
}

export function unprojectMercator(x: number, y: number): LngLatTuple {
  const lng = x * 360 - 180
  const n = Math.PI * (1 - 2 * y)
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n))
  return [lng, lat]
}

export interface Arc {
  /** Start, control and end points, all in normalised Mercator space. */
  a: Vec2
  c: Vec2
  b: Vec2
  /** `samples` points along the curve, in `[lng, lat]`. */
  points: LngLatTuple[]
  /** Great-circle length of the chord in kilometres, for labels/telemetry. */
  chordKm: number
}

export interface ArcOptions {
  /** Number of points sampled along the curve. */
  samples?: number
  /** Control point offset as a fraction of chord length. */
  curvature?: number
  /** Which side of the chord the curve bows towards. */
  side?: 1 | -1
}

function bezierAt(a: Vec2, c: Vec2, b: Vec2, t: number): Vec2 {
  const mt = 1 - t
  const w0 = mt * mt
  const w1 = 2 * mt * t
  const w2 = t * t
  return [a[0] * w0 + c[0] * w1 + b[0] * w2, a[1] * w0 + c[1] * w1 + b[1] * w2]
}

/**
 * Quadratic bezier from `from` to `to`, with the control point pushed
 * perpendicular to the chord by `curvature * chordLength`.
 */
export function buildArc(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
  options: ArcOptions = {},
): Arc {
  const { samples = 64, curvature = 0.25, side = 1 } = options
  const a = projectMercator(from.lng, from.lat)
  const b = projectMercator(to.lng, to.lat)

  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)

  let c: Vec2
  if (len === 0) {
    c = [a[0], a[1]]
  } else {
    // Rotate the chord 90 degrees. Using the same rotation for every spoke
    // makes the whole fan bow consistently instead of looking scattered.
    const px = -dy / len
    const py = dx / len
    const offset = curvature * len * side
    c = [(a[0] + b[0]) / 2 + px * offset, (a[1] + b[1]) / 2 + py * offset]
  }

  const points: LngLatTuple[] = []
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1)
    const [x, y] = bezierAt(a, c, b, t)
    points.push(unprojectMercator(x, y))
  }

  const chordKm = distance(point([from.lng, from.lat]), point([to.lng, to.lat]), {
    units: 'kilometers',
  })

  return { a, c, b, points, chordKm }
}

/** Point on the curve at parameter `t`, in `[lng, lat]`. */
export function arcPointAt(arc: Arc, t: number): LngLatTuple {
  const [x, y] = bezierAt(arc.a, arc.c, arc.b, Math.max(0, Math.min(1, t)))
  return unprojectMercator(x, y)
}

/**
 * The arc revealed up to `t`. Slices the pre-sampled array and appends the
 * exact curve point at `t`, so the leading tip advances smoothly instead of
 * snapping between the 64 samples.
 */
export function sliceArc(arc: Arc, t: number): LngLatTuple[] {
  const clamped = Math.max(0, Math.min(1, t))
  if (clamped <= 0) return []

  const last = arc.points.length - 1
  const exact = clamped * last
  const whole = Math.floor(exact)
  const sliced = arc.points.slice(0, whole + 1)

  if (exact > whole) sliced.push(arcPointAt(arc, clamped))
  // A LineString needs two positions to be renderable.
  if (sliced.length < 2) sliced.push(arcPointAt(arc, clamped))

  return sliced
}

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

/** Axis-aligned bounds over every place, with a floor so a single point still works. */
export function boundsOf(places: Place[]): Bounds | null {
  if (places.length === 0) return null

  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const p of places) {
    west = Math.min(west, p.lng)
    east = Math.max(east, p.lng)
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
  }

  // Arcs bow outside the convex hull of the points, so widen a little to
  // keep the curves inside frame.
  const padLng = Math.max((east - west) * 0.18, 0.12)
  const padLat = Math.max((north - south) * 0.18, 0.12)

  return {
    west: west - padLng,
    south: south - padLat,
    east: east + padLng,
    north: north + padLat,
  }
}

export function formatKm(km: number): string {
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}
