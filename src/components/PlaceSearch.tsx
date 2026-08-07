import { useCallback, useEffect, useRef, useState } from 'react'
import { parseLatLng, searchPlaces, type GeocodeResult } from '../lib/geocode.ts'

const DEBOUNCE_MS = 800

interface PlaceSearchProps {
  placeholder: string
  label: string
  onPick: (result: GeocodeResult) => void
  testId?: string
}

/**
 * Debounced place lookup with a raw-coordinate escape hatch. Small towns are
 * often missing from Nominatim, so "16.5062, 80.648" is always accepted.
 */
export function PlaceSearch({ placeholder, label, onPick, testId }: PlaceSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'error' | 'empty'>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const coords = parseLatLng(query)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2 || coords) {
      setResults([])
      setStatus('idle')
      return
    }

    setStatus('searching')
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      searchPlaces(trimmed, { signal: controller.signal })
        .then((found) => {
          if (controller.signal.aborted) return
          setResults(found)
          setStatus(found.length === 0 ? 'empty' : 'idle')
          setError(null)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return
          setResults([])
          setStatus('error')
          setError(
            err instanceof Error
              ? err.message
              : 'Could not reach the geocoder. Paste "lat, lng" instead.',
          )
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, coords])

  useEffect(() => () => abortRef.current?.abort(), [])

  const choose = useCallback(
    (result: GeocodeResult) => {
      onPick(result)
      setQuery('')
      setResults([])
      setStatus('idle')
      setError(null)
    },
    [onPick],
  )

  const acceptCoords = useCallback(() => {
    if (!coords) return
    choose({
      name: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
      displayName: 'Manual coordinates',
      lat: coords.lat,
      lng: coords.lng,
    })
  }, [coords, choose])

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-400">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={query}
          data-testid={testId}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (coords) acceptCoords()
            else if (results.length > 0) choose(results[0])
          }}
          className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/60"
        />
        {status === 'searching' && !coords && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
            searching…
          </span>
        )}
      </div>

      {coords && (
        <button
          type="button"
          data-testid="accept-coords"
          onClick={acceptCoords}
          className="w-full rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-left text-xs text-sky-200 transition hover:bg-sky-500/20"
        >
          Use coordinates {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
        </button>
      )}

      {results.length > 0 && (
        <ul
          data-testid="place-results"
          className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/80"
        >
          {results.map((result) => (
            <li key={`${result.lat},${result.lng},${result.displayName}`}>
              <button
                type="button"
                onClick={() => choose(result)}
                className="w-full px-3 py-2 text-left text-xs transition hover:bg-white/5"
              >
                <span className="block font-medium text-slate-100">{result.name}</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {result.displayName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {status === 'empty' && (
        <p className="text-[11px] text-slate-500">
          No match. You can paste raw coordinates as “lat, lng” instead.
        </p>
      )}
      {status === 'error' && error && (
        <p data-testid="geocode-error" className="text-[11px] text-amber-300">
          {error} You can paste raw coordinates as “lat, lng” instead.
        </p>
      )}
    </div>
  )
}
