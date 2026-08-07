import { setWorkerUrl } from 'maplibre-gl'
// MapLibre 6 derives its worker URL at runtime from `import.meta.url`
// (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`). Because that is
// computed rather than a static literal, the bundler cannot see it and never
// emits the worker chunk — the production build then silently hangs with
// every GeoJSON source stuck "not loaded". Importing the worker explicitly
// makes it part of the graph (together with its shared chunk) and
// setWorkerUrl points MapLibre at the emitted asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

let installed = false

export function installMapLibreWorker(): void {
  if (installed) return
  installed = true
  setWorkerUrl(workerUrl)
}
