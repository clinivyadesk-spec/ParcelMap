import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * A short identifier for the running build, shown in the UI footer.
 *
 * Without this there is no way to tell a stale deploy from stale
 * localStorage, which is exactly the confusion that motivated it. Cloudflare
 * Pages exposes the commit it built; fall back to git locally, and to a
 * timestamp when neither is available.
 */
function buildId(): string {
  const fromPages = process.env.CF_PAGES_COMMIT_SHA
  if (fromPages) return fromPages.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return new Date().toISOString().slice(0, 16).replace('T', ' ')
  }
}

/**
 * Emit /version.json alongside the app.
 *
 * The build id compiled into the bundle only tells you anything once the
 * bundle loads, which is no help when the question is "is the right bundle
 * being served at all". A plain static file answers that from a URL bar, with
 * no JavaScript, no cache ambiguity and nothing to interpret.
 */
function versionFile(id: string): Plugin {
  return {
    name: 'parcelmap-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ build: id, builtAt: new Date().toISOString() }, null, 2)}\n`,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(() => {
  const id = buildId()
  return {
    plugins: [react(), tailwindcss(), versionFile(id)],
    define: {
      __BUILD_ID__: JSON.stringify(id),
    },
  }
})
