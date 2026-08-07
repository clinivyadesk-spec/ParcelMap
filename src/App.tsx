import { useCallback, useMemo, useState } from 'react'
import { StageView } from './components/StageView'
import { styleOverride } from './lib/devFlags'
import { SMOKE_DESTINATIONS, VIJAYAWADA } from './lib/sampleData'
import type { MapStage } from './lib/stage'
import { DEFAULT_SETTINGS, type Scene } from './lib/types'

export default function App() {
  const [ready, setReady] = useState(false)

  const scene = useMemo<Scene>(
    () => ({
      origin: VIJAYAWADA,
      destinations: SMOKE_DESTINATIONS,
      settings: { ...DEFAULT_SETTINGS, mapStyle: styleOverride() ?? 'positron' },
    }),
    [],
  )

  const handleReady = useCallback((stage: MapStage) => {
    stage.renderFrame(0)
    setReady(true)
    ;(window as unknown as { __stage?: MapStage }).__stage = stage
  }, [])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold">ParcelMap — stage smoke test</h1>
      <p data-testid="ready-flag" className="text-xs text-slate-400">
        {ready ? 'stage-ready' : 'stage-loading'}
      </p>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <StageView scene={scene} onReady={handleReady} />
      </div>
    </div>
  )
}
