import { DEFAULT_SETTINGS, type Place, type Project } from './types'

let idCounter = 0
export function newId(prefix = 'p'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

export const VIJAYAWADA: Place = {
  id: 'origin_vijayawada',
  name: 'Vijayawada',
  lng: 80.648,
  lat: 16.5062,
  subLabel: 'Dispatch hub',
  address: 'Vijayawada, NTR District, Andhra Pradesh',
}

/** A realistic intra-Andhra-Pradesh run for a pharmacy distributor. */
export const SAMPLE_DESTINATIONS: Place[] = [
  { id: 'd_guntur', name: 'Guntur', lng: 80.4365, lat: 16.3067, subLabel: '42 units' },
  { id: 'd_tenali', name: 'Tenali', lng: 80.64, lat: 16.243, subLabel: '18 units' },
  { id: 'd_eluru', name: 'Eluru', lng: 81.0952, lat: 16.7107, subLabel: '26 units' },
  { id: 'd_gudivada', name: 'Gudivada', lng: 80.993, lat: 16.4333, subLabel: '12 units' },
  { id: 'd_machilipatnam', name: 'Machilipatnam', lng: 81.1389, lat: 16.1875, subLabel: '31 units' },
  { id: 'd_nuzvid', name: 'Nuzvid', lng: 80.8461, lat: 16.7877, subLabel: '9 units' },
  { id: 'd_bhimavaram', name: 'Bhimavaram', lng: 81.5212, lat: 16.5449, subLabel: '24 units' },
  { id: 'd_narasaraopet', name: 'Narasaraopet', lng: 80.049, lat: 16.235, subLabel: '16 units' },
  { id: 'd_ongole', name: 'Ongole', lng: 80.0499, lat: 15.5057, subLabel: '28 units' },
  { id: 'd_chirala', name: 'Chirala', lng: 80.352, lat: 15.8237, subLabel: '11 units' },
  { id: 'd_rajahmundry', name: 'Rajahmundry', lng: 81.804, lat: 17.0005, subLabel: '35 units' },
  { id: 'd_kakinada', name: 'Kakinada', lng: 82.2475, lat: 16.9891, subLabel: '22 units' },
]

/** The five-town subset used by the render smoke tests. */
export const SMOKE_DESTINATIONS: Place[] = SAMPLE_DESTINATIONS.slice(0, 5)

export function sampleProject(): Project {
  return {
    id: newId('proj'),
    name: 'Vijayawada daily run',
    origin: { ...VIJAYAWADA },
    destinations: SAMPLE_DESTINATIONS.map((d) => ({ ...d })),
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: Date.now(),
  }
}
