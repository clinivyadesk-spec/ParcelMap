import type { StyleSpecification } from 'maplibre-gl'
import type { MapStyleId } from './types.ts'

/**
 * OpenFreeMap serves these styles and its tiles with no API key and no
 * account. Nothing in this app ever needs a token.
 */
export const OPENFREEMAP_STYLES: Record<'positron' | 'liberty', string> = {
  positron: 'https://tiles.openfreemap.org/styles/positron',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
}

export const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
  positron: 'Positron (light, minimal)',
  liberty: 'Liberty (full colour)',
  offline: 'Offline grid (no tiles)',
}

function graticule(stepDeg: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const isMajor = (v: number) => Math.abs(v - Math.round(v)) < 1e-9

  // Only cover the region we care about; a whole-globe grid at this spacing
  // would be a lot of geometry for no benefit.
  for (let lng = 60; lng <= 100; lng += stepDeg) {
    features.push({
      type: 'Feature',
      properties: { major: isMajor(lng) },
      geometry: {
        type: 'LineString',
        coordinates: [
          [lng, 0],
          [lng, 40],
        ],
      },
    })
  }
  for (let lat = 0; lat <= 40; lat += stepDeg) {
    features.push({
      type: 'Feature',
      properties: { major: isMajor(lat) },
      geometry: {
        type: 'LineString',
        coordinates: [
          [60, lat],
          [100, lat],
        ],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

/**
 * A self-contained style with zero network dependencies. It exists so the
 * renderer and the MP4 export can be exercised in CI (and so the app degrades
 * to something usable if the tile host is unreachable) without pulling tiles.
 */
export function offlineStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'ParcelMap offline grid',
    sources: {
      graticule: { type: 'geojson', data: graticule(0.25) as never },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e8eef5' } },
      {
        id: 'graticule-minor',
        type: 'line',
        source: 'graticule',
        filter: ['!', ['get', 'major']],
        paint: { 'line-color': '#c7d4e2', 'line-width': 1 },
      },
      {
        id: 'graticule-major',
        type: 'line',
        source: 'graticule',
        filter: ['get', 'major'],
        paint: { 'line-color': '#9fb3c8', 'line-width': 1.6 },
      },
    ],
  }
}

export function resolveStyle(id: MapStyleId): string | StyleSpecification {
  if (id === 'offline') return offlineStyle()
  return OPENFREEMAP_STYLES[id]
}
