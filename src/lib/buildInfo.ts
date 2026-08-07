/** Build this bundle was compiled from. Injected by vite.config.ts. */
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

interface VersionFile {
  build?: string
  builtAt?: string
}

/**
 * Ask the server which build it is currently serving.
 *
 * A browser holding a stale HTML shell will keep loading the bundle that
 * shell references and never notice a deploy — the failure looks exactly like
 * the app ignoring your changes. `version.json` is written at build time and
 * served with no-cache, so comparing it against the id compiled into this
 * bundle catches that from inside the stale page itself.
 *
 * Returns the deployed build id when it differs from ours, otherwise null.
 * Any failure (offline, dev server with no version.json) returns null: this
 * is a convenience, never a reason to interrupt someone.
 */
export async function fetchDeployedBuild(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json`, {
      cache: 'no-store',
      signal,
    })
    if (!response.ok) return null

    const data = (await response.json()) as VersionFile
    if (typeof data.build !== 'string' || data.build.length === 0) return null

    return data.build === BUILD_ID ? null : data.build
  } catch {
    return null
  }
}
