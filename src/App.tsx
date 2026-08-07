import { useCallback, useMemo, useState } from 'react'
import { ExportPanel } from './components/ExportPanel.tsx'
import { Preview } from './components/Preview.tsx'
import { styleOverride } from './lib/devFlags.ts'
import { SAMPLE_DESTINATIONS, VIJAYAWADA } from './lib/sampleData.ts'
import type { MapStage } from './lib/stage.ts'
import { DEFAULT_SETTINGS, type Scene } from './lib/types.ts'

export default function App() {
  const [stage, setStage] = useState<MapStage | null>(null)
  const [rendering, setRendering] = useState(false)

  const scene = useMemo<Scene>(
    () => ({
      origin: VIJAYAWADA,
      destinations: SAMPLE_DESTINATIONS,
      settings: { ...DEFAULT_SETTINGS, mapStyle: styleOverride() ?? 'positron' },
    }),
    [],
  )

  const handleStage = useCallback((next: MapStage | null) => setStage(next), [])

  return (
    <div className="flex h-full gap-6 p-6">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4">
        <h1 className="shrink-0 text-lg font-semibold">ParcelMap</h1>
        <Preview scene={scene} onStageReady={handleStage} disabled={rendering} />
      </div>
      <aside className="w-80 shrink-0 self-start rounded-xl bg-slate-900/70 p-4 ring-1 ring-white/10">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Export</h2>
        <ExportPanel stage={stage} onRenderingChange={setRendering} />
      </aside>
    </div>
  )
}
