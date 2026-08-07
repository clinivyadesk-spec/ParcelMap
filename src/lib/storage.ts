import { newId } from './sampleData.ts'
import { DEFAULT_SETTINGS, type Place, type Project, type VideoSettings } from './types.ts'

const PROJECTS_KEY = 'parcelmap.projects.v1'
const CURRENT_KEY = 'parcelmap.currentProject.v1'

function isPlace(value: unknown): value is Place {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<Place>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    Number.isFinite(p.lng) &&
    Number.isFinite(p.lat)
  )
}

/**
 * Coerce whatever is in storage into a valid project. Anything written by an
 * older build (or hand-edited) is repaired rather than throwing the user's
 * work away.
 */
function normaliseProject(raw: unknown): Project | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Partial<Project>
  if (typeof p.id !== 'string') return null

  const settings: VideoSettings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) }
  if (!['9:16', '1:1', '16:9'].includes(settings.aspect)) settings.aspect = DEFAULT_SETTINGS.aspect
  if (!['positron', 'liberty', 'offline'].includes(settings.mapStyle)) {
    settings.mapStyle = DEFAULT_SETTINGS.mapStyle
  }
  if (!Number.isFinite(settings.secondsPerDestination)) {
    settings.secondsPerDestination = DEFAULT_SETTINGS.secondsPerDestination
  }
  settings.secondsPerDestination = Math.min(3, Math.max(0.1, settings.secondsPerDestination))

  return {
    id: p.id,
    name: typeof p.name === 'string' && p.name ? p.name : 'Untitled project',
    origin: isPlace(p.origin) ? p.origin : null,
    destinations: Array.isArray(p.destinations) ? p.destinations.filter(isPlace) : [],
    settings,
    updatedAt: Number.isFinite(p.updatedAt) ? (p.updatedAt as number) : Date.now(),
  }
}

export function listProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normaliseProject)
      .filter((p): p is Project => p !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

function persist(projects: Project[]): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
  } catch (err) {
    console.warn('[ParcelMap] could not save projects', err)
  }
}

export function saveProject(project: Project): Project {
  const stamped = { ...project, updatedAt: Date.now() }
  const others = listProjects().filter((p) => p.id !== project.id)
  persist([stamped, ...others])
  setCurrentProjectId(stamped.id)
  return stamped
}

export function deleteProject(id: string): void {
  persist(listProjects().filter((p) => p.id !== id))
  if (getCurrentProjectId() === id) setCurrentProjectId(null)
}

export function getProject(id: string): Project | null {
  return listProjects().find((p) => p.id === id) ?? null
}

export function getCurrentProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

export function setCurrentProjectId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id)
    else localStorage.removeItem(CURRENT_KEY)
  } catch {
    /* ignore */
  }
}

export function emptyProject(name = 'Untitled run'): Project {
  return {
    id: newId('proj'),
    name,
    origin: null,
    destinations: [],
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: Date.now(),
  }
}
