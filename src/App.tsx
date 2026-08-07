import { useMemo } from 'react'
import { Preview } from './components/Preview.tsx'
import { styleOverride } from './lib/devFlags.ts'
import { SAMPLE_DESTINATIONS, VIJAYAWADA } from './lib/sampleData.ts'
import { DEFAULT_SETTINGS, type Scene } from './lib/types.ts'

export default function App() {
  const scene = useMemo<Scene>(
    () => ({
      origin: VIJAYAWADA,
      destinations: SAMPLE_DESTINATIONS,
      settings: { ...DEFAULT_SETTINGS, mapStyle: styleOverride() ?? 'positron' },
    }),
    [],
  )

  return (
    <div className="flex h-full flex-col items-center gap-4 p-6">
      <h1 className="shrink-0 text-lg font-semibold">ParcelMap — animation preview</h1>
      <Preview scene={scene} />
    </div>
  )
}
