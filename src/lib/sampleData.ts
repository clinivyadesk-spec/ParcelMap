import { DEFAULT_SETTINGS, type Place, type Project } from './types.ts'

let idCounter = 0
export function newId(prefix = 'p'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

/** The clinic the default project ships out from. */
export const CLINIC_HUB: Place = {
  id: 'origin_dr_rakesh',
  name: "Dr Rakesh's Homoeopathy",
  lng: 80.616,
  lat: 16.5115,
  subLabel: 'Main branch',
  address: 'Vijayawada, NTR District, Andhra Pradesh',
}

/** The towns the default project delivers to. */
export const SAMPLE_DESTINATIONS: Place[] = [
  { id: 'd_ongole', name: 'Ongole', lng: 80.0499, lat: 15.5057, subLabel: '28 medicines' },
  { id: 'd_chirala', name: 'Chirala', lng: 80.352, lat: 15.8237, subLabel: '1 medicine' },
  { id: 'd_chennai', name: 'Chennai', lng: 80.2707, lat: 13.0827, subLabel: '16 medicines' },
  { id: 'd_nellore', name: 'Nellore', lng: 79.9865, lat: 14.4426, subLabel: '9 medicines' },
  { id: 'd_tirupati', name: 'Tirupati', lng: 79.4192, lat: 13.6288, subLabel: '12 medicines' },
]

/**
 * A deliberately crowded fan, used by the render tests to stress label
 * placement. Not shown in the app.
 */
export const STRESS_DESTINATIONS: Place[] = [
  { id: 's_guntur', name: 'Guntur', lng: 80.4365, lat: 16.3067, subLabel: '42 units' },
  { id: 's_tenali', name: 'Tenali', lng: 80.64, lat: 16.243, subLabel: '18 units' },
  { id: 's_eluru', name: 'Eluru', lng: 81.0952, lat: 16.7107, subLabel: '26 units' },
  { id: 's_gudivada', name: 'Gudivada', lng: 80.993, lat: 16.4333, subLabel: '12 units' },
  { id: 's_machilipatnam', name: 'Machilipatnam', lng: 81.1389, lat: 16.1875, subLabel: '31 units' },
  { id: 's_nuzvid', name: 'Nuzvid', lng: 80.8461, lat: 16.7877, subLabel: '9 units' },
  { id: 's_bhimavaram', name: 'Bhimavaram', lng: 81.5212, lat: 16.5449, subLabel: '24 units' },
  { id: 's_narasaraopet', name: 'Narasaraopet', lng: 80.049, lat: 16.235, subLabel: '16 units' },
  { id: 's_ongole', name: 'Ongole', lng: 80.0499, lat: 15.5057, subLabel: '28 units' },
  { id: 's_chirala', name: 'Chirala', lng: 80.352, lat: 15.8237, subLabel: '11 units' },
  { id: 's_rajahmundry', name: 'Rajahmundry', lng: 81.804, lat: 17.0005, subLabel: '35 units' },
  { id: 's_kakinada', name: 'Kakinada', lng: 82.2475, lat: 16.9891, subLabel: '22 units' },
]

export function sampleProject(): Project {
  return {
    id: newId('proj'),
    name: "Dr Rakesh's Homoeopathy — daily run",
    origin: { ...CLINIC_HUB },
    destinations: SAMPLE_DESTINATIONS.map((d) => ({ ...d })),
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: Date.now(),
  }
}
