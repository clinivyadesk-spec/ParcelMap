export type AspectRatio = '9:16' | '1:1' | '16:9'

export type MapStyleId = 'positron' | 'liberty' | 'offline'

/** A geocoded point on the map. */
export interface Place {
  id: string
  /** Editable display label, e.g. "Guntur". */
  name: string
  lng: number
  lat: number
  /** Optional second line under the pin, e.g. "24 units". */
  subLabel?: string
  /** Full address string returned by the geocoder, kept for the editor only. */
  address?: string
}

export interface VideoSettings {
  title: string
  subtitle: string
  aspect: AspectRatio
  arcColor: string
  mapStyle: MapStyleId
  /** Stagger between consecutive destination reveals, in seconds. */
  secondsPerDestination: number
  /** Optional slow 5% zoom-out across the whole clip. Camera is static otherwise. */
  slowZoomOut: boolean
  /** Small wordmark drawn in the corner. Empty string hides it. */
  logoText: string
}

export interface Project {
  id: string
  name: string
  origin: Place | null
  destinations: Place[]
  settings: VideoSettings
  updatedAt: number
}

/** Everything the renderer needs to draw a frame. */
export interface Scene {
  origin: Place
  destinations: Place[]
  settings: VideoSettings
}

export const ASPECT_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
}

export const DEFAULT_SETTINGS: VideoSettings = {
  title: 'Daily Dispatch',
  subtitle: 'Vijayawada → Andhra Pradesh',
  aspect: '9:16',
  arcColor: '#f97316',
  mapStyle: 'positron',
  secondsPerDestination: 0.6,
  slowZoomOut: false,
  logoText: 'ParcelMap',
}
