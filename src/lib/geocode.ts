const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const CACHE_KEY = 'parcelmap.geocache.v1'
const CACHE_LIMIT = 400

/**
 * Nominatim's usage policy asks for a descriptive identifier. Browsers refuse
 * to let fetch override User-Agent (it is a forbidden header name and is
 * dropped silently), so the header below is best-effort and the Referer the
 * browser sends is what actually identifies us. The parts of the policy we
 * can honour from here — one request per second, and aggressive caching so a
 * repeated lookup never leaves the machine — are enforced below.
 */
const USER_AGENT = 'ParcelMap/1.0 (client-side hub-and-spoke delivery map animator)'
const MIN_REQUEST_INTERVAL_MS = 1100

export interface GeocodeResult {
  /** Short label, suitable as the pin caption. */
  name: string
  /** Full address line from the geocoder. */
  displayName: string
  lng: number
  lat: number
}

export class GeocodeError extends Error {}

// --- result cache -----------------------------------------------------------

type CacheShape = Record<string, GeocodeResult[]>

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as CacheShape) : {}
  } catch {
    return {}
  }
}

function writeCache(cache: CacheShape): void {
  try {
    const keys = Object.keys(cache)
    if (keys.length > CACHE_LIMIT) {
      // Cheap eviction: drop the oldest half of the insertion order.
      const trimmed: CacheShape = {}
      for (const key of keys.slice(keys.length - Math.floor(CACHE_LIMIT / 2))) {
        trimmed[key] = cache[key]
      }
      cache = trimmed
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // A full or unavailable localStorage should never break geocoding.
  }
}

function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function clearGeocodeCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}

// --- "lat,lng" fallback -----------------------------------------------------

/**
 * Accepts raw coordinates so a user can keep working when the geocoder has
 * nothing for a small town. Input is `lat, lng`, matching what people copy
 * out of Google Maps.
 */
export function parseLatLng(input: string): { lat: number; lng: number } | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input)
  if (!match) return null

  const lat = Number(match[1])
  const lng = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  return { lat, lng }
}

// --- request throttle -------------------------------------------------------

let lastRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

/** Serialise requests and keep them at least one second apart. */
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt = Date.now()
    return task()
  })
  // Keep the chain alive even when a request rejects.
  queue = run.catch(() => undefined)
  return run
}

// --- search -----------------------------------------------------------------

interface NominatimRow {
  display_name?: string
  name?: string
  lat?: string
  lon?: string
  address?: Record<string, string>
}

function shortNameFor(row: NominatimRow): string {
  if (row.name) return row.name
  const address = row.address ?? {}
  const candidate =
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.suburb ??
    address.county
  if (candidate) return candidate
  return (row.display_name ?? '').split(',')[0]?.trim() || 'Unnamed place'
}

export interface SearchOptions {
  signal?: AbortSignal
  /** ISO country codes to bias the search. Defaults to India. */
  countryCodes?: string
  limit?: number
}

/**
 * Look up a place name. Results are cached in localStorage, so editing a
 * project you have opened before does no network traffic at all.
 */
export async function searchPlaces(
  query: string,
  options: SearchOptions = {},
): Promise<GeocodeResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const key = cacheKey(trimmed)
  const cache = readCache()
  const hit = cache[key]
  if (hit) return hit

  const url = new URL(NOMINATIM_URL)
  url.searchParams.set('format', 'json')
  url.searchParams.set('q', trimmed)
  url.searchParams.set('countrycodes', options.countryCodes ?? 'in')
  url.searchParams.set('limit', String(options.limit ?? 6))
  url.searchParams.set('addressdetails', '1')

  const response = await throttled(() =>
    fetch(url.toString(), {
      signal: options.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    }),
  )

  if (!response.ok) {
    throw new GeocodeError(`Geocoder returned ${response.status}. Try again in a moment.`)
  }

  const rows = (await response.json()) as NominatimRow[]
  const results: GeocodeResult[] = rows
    .filter((row) => row.lat != null && row.lon != null)
    .map((row) => ({
      name: shortNameFor(row),
      displayName: row.display_name ?? shortNameFor(row),
      lat: Number(row.lat),
      lng: Number(row.lon),
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))

  cache[key] = results
  writeCache(cache)
  return results
}
