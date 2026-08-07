import { useCallback, useEffect, useMemo, useState } from 'react'
import { DestinationList } from './components/DestinationList.tsx'
import { ExportPanel } from './components/ExportPanel.tsx'
import { PlaceSearch } from './components/PlaceSearch.tsx'
import { Preview } from './components/Preview.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { styleOverride } from './lib/devFlags.ts'
import type { GeocodeResult } from './lib/geocode.ts'
import { newId, sampleProject } from './lib/sampleData.ts'
import type { MapStage } from './lib/stage.ts'
import {
  deleteProject,
  emptyProject,
  getCurrentProjectId,
  getProject,
  listProjects,
  saveProject,
} from './lib/storage.ts'
import type { Place, Project, Scene, VideoSettings } from './lib/types.ts'

const AUTOSAVE_DELAY_MS = 700

function Section({ title, children, action }: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-xl bg-slate-900/60 p-4 ring-1 ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function App() {
  const [project, setProject] = useState<Project>(() => {
    const currentId = getCurrentProjectId()
    const existing = currentId ? getProject(currentId) : null
    if (existing) return existing
    // First visit: start from the worked example rather than a blank page.
    return listProjects()[0] ?? sampleProject()
  })
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [stage, setStage] = useState<MapStage | null>(null)
  const [rendering, setRendering] = useState(false)
  const [projects, setProjects] = useState<Project[]>(() => listProjects())

  const styleForced = useMemo(() => styleOverride(), [])

  // Autosave, debounced so typing a title does not thrash localStorage. A
  // brand new project with nothing in it is deliberately not written, so
  // clicking "New" does not litter the Open list with empty entries.
  const worthSaving = project.origin != null || project.destinations.length > 0
  useEffect(() => {
    if (!worthSaving) {
      setPending(false)
      return
    }
    setPending(true)
    const timer = setTimeout(() => {
      saveProject(project)
      setProjects(listProjects())
      setSaved(new Date().toLocaleTimeString())
      setPending(false)
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [project, worthSaving])

  const patchSettings = useCallback((patch: Partial<VideoSettings>) => {
    setProject((p) => ({ ...p, settings: { ...p.settings, ...patch } }))
  }, [])

  const setOrigin = useCallback((result: GeocodeResult) => {
    setProject((p) => ({
      ...p,
      origin: {
        id: p.origin?.id ?? newId('origin'),
        name: result.name,
        lng: result.lng,
        lat: result.lat,
        subLabel: p.origin?.subLabel,
        address: result.displayName,
      },
    }))
  }, [])

  const addDestination = useCallback((result: GeocodeResult) => {
    setProject((p) => ({
      ...p,
      destinations: [
        ...p.destinations,
        {
          id: newId('dest'),
          name: result.name,
          lng: result.lng,
          lat: result.lat,
          address: result.displayName,
        },
      ],
    }))
  }, [])

  const setDestinations = useCallback((destinations: Place[]) => {
    setProject((p) => ({ ...p, destinations }))
  }, [])

  const scene = useMemo<Scene | null>(() => {
    if (!project.origin) return null
    return {
      origin: project.origin,
      destinations: project.destinations,
      settings: styleForced
        ? { ...project.settings, mapStyle: styleForced }
        : project.settings,
    }
  }, [project.origin, project.destinations, project.settings, styleForced])

  const handleStage = useCallback((next: MapStage | null) => setStage(next), [])

  const exportBlocked =
    !project.origin
      ? 'Set an origin city first.'
      : project.destinations.length === 0
        ? 'Add at least one destination.'
        : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tracking-tight text-sky-400">ParcelMap</span>
          <span className="hidden text-xs text-slate-500 sm:inline">
            hub-and-spoke delivery animations, rendered in your browser
          </span>
        </div>

        {/* Swapping or clearing the project mid-render corrupts the file too. */}
        <fieldset
          disabled={rendering}
          data-testid="project-controls"
          className="ml-auto flex flex-wrap items-center gap-3 disabled:opacity-60"
        >
        <input
          value={project.name}
          data-testid="project-name"
          aria-label="Project name"
          onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
          className="w-52 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 text-sm outline-none focus:border-sky-500/60"
        />

        <select
          value=""
          data-testid="project-picker"
          aria-label="Open a saved project"
          onChange={(e) => {
            const found = getProject(e.target.value)
            if (found) setProject(found)
          }}
          className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500/60"
        >
          <option value="">Open…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.destinations.length})
            </option>
          ))}
        </select>

        <button
          type="button"
          data-testid="new-project"
          onClick={() => setProject(emptyProject())}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/5"
        >
          New
        </button>
        <button
          type="button"
          data-testid="load-sample"
          onClick={() => setProject(sampleProject())}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/5"
        >
          Load sample
        </button>
        <button
          type="button"
          data-testid="delete-project"
          onClick={() => {
            deleteProject(project.id)
            const remaining = listProjects()
            setProjects(remaining)
            setProject(remaining[0] ?? emptyProject())
          }}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300"
        >
          Delete
        </button>
        </fieldset>
        <span data-testid="save-status" className="w-28 text-right text-[11px] text-slate-600">
          {pending ? 'saving…' : saved ? `saved ${saved}` : ''}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/*
          The exporter configures its encoder for one frame size and one
          timeline, then renders against the live stage. Editing anything
          mid-render silently corrupts the file, so the whole editor is inert
          until it finishes.
        */}
        <fieldset
          disabled={rendering}
          data-testid="editor-panel"
          className="w-[380px] shrink-0 space-y-4 overflow-y-auto border-r border-white/10 p-4 disabled:opacity-60"
        >
          <Section title="Origin">
            {project.origin && (
              <div
                data-testid="origin-summary"
                className="mb-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-2.5"
              >
                <input
                  value={project.origin.name}
                  data-testid="origin-name"
                  aria-label="Origin name"
                  onChange={(e) =>
                    setProject((p) => ({
                      ...p,
                      origin: p.origin ? { ...p.origin, name: e.target.value } : null,
                    }))
                  }
                  className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-sky-100 outline-none hover:border-white/10 focus:border-sky-500/60 focus:bg-slate-950"
                />
                <input
                  value={project.origin.subLabel ?? ''}
                  data-testid="origin-sublabel"
                  aria-label="Origin sub-label"
                  placeholder="Sub-label, e.g. Dispatch hub"
                  onChange={(e) =>
                    setProject((p) => ({
                      ...p,
                      origin: p.origin ? { ...p.origin, subLabel: e.target.value } : null,
                    }))
                  }
                  className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-sky-200/70 outline-none placeholder:text-sky-200/30 hover:border-white/10 focus:border-sky-500/60 focus:bg-slate-950"
                />
                <p className="px-1 font-mono text-[10px] text-sky-200/50">
                  {project.origin.lat.toFixed(4)}, {project.origin.lng.toFixed(4)}
                </p>
              </div>
            )}
            <PlaceSearch
              label={project.origin ? 'Change origin' : 'Search for the dispatch hub'}
              placeholder="Vijayawada — or 16.5062, 80.648"
              testId="origin-search"
              onPick={setOrigin}
            />
          </Section>

          <Section
            title="Destinations"
            action={
              <span className="text-xs text-slate-500">{project.destinations.length}</span>
            }
          >
            <div className="mb-3">
              <PlaceSearch
                label="Add a town"
                placeholder="Guntur — or 16.3067, 80.4365"
                testId="destination-search"
                onPick={addDestination}
              />
            </div>
            <DestinationList
              destinations={project.destinations}
              onChange={setDestinations}
              disabled={rendering}
            />
          </Section>

          <Section title="Video settings">
            <SettingsPanel
              settings={project.settings}
              destinationCount={project.destinations.length}
              onChange={patchSettings}
            />
          </Section>
        </fieldset>

        <main className="flex min-h-0 flex-1 flex-col items-center gap-4 p-5">
          {scene ? (
            <Preview scene={scene} onStageReady={handleStage} disabled={rendering} />
          ) : (
            <div
              data-testid="no-origin"
              className="flex flex-1 items-center justify-center text-sm text-slate-500"
            >
              Set an origin city to see the preview.
            </div>
          )}
        </main>

        <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-white/10 p-4">
          <Section title="Export MP4">
            <ExportPanel
              stage={scene ? stage : null}
              disabledReason={exportBlocked}
              onRenderingChange={setRendering}
            />
          </Section>
          {stage?.usedFallbackStyle && (
            <p className="rounded-lg bg-amber-500/10 p-3 text-[11px] text-amber-200">
              The OpenFreeMap basemap could not be reached, so the offline grid is being used
              instead. Check your connection and reload to get real map tiles.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
