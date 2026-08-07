import type { MapStyleId } from './types'

/**
 * Query-string escape hatches used by the automated render tests (and handy
 * when debugging locally). None of them are needed for normal use.
 *
 *   ?style=offline    force a specific basemap, including the no-network one
 *   ?codec=vp09...    override the export codec probe order
 *   ?frames=90        cap the export length, for quick test clips
 */
function params(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

export function styleOverride(): MapStyleId | null {
  const value = params().get('style')
  if (value === 'positron' || value === 'liberty' || value === 'offline') return value
  return null
}

export function codecOverride(): string[] | null {
  const value = params().get('codec')
  if (!value) return null
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

export function frameCapOverride(): number | null {
  const value = Number(params().get('frames'))
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}
