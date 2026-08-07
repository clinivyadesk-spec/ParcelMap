import { useEffect, useState } from 'react'
import { BUILD_ID, fetchDeployedBuild } from '../lib/buildInfo.ts'

interface UpdateBannerProps {
  /** Suppressed during a render — reloading would throw the work away. */
  busy?: boolean
}

/**
 * Tells the user when the server is serving a newer build than the one they
 * have loaded, which otherwise presents as "the app is ignoring my changes".
 */
export function UpdateBanner({ busy }: UpdateBannerProps) {
  const [deployed, setDeployed] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const check = async () => {
      if (document.visibilityState === 'hidden') return
      const newer = await fetchDeployedBuild(controller.signal)
      if (!cancelled && newer) setDeployed(newer)
    }

    void check()
    // Re-check when the tab is brought back, which is when a deploy is most
    // likely to have happened since the page was opened.
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, 10 * 60 * 1000)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  if (!deployed || busy) return null

  return (
    <div
      data-testid="update-banner"
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100 lg:px-5"
    >
      <span>
        A newer version of ParcelMap is available. You are running{' '}
        <code className="font-mono text-sky-300">{BUILD_ID}</code>, the server has{' '}
        <code className="font-mono text-sky-300">{deployed}</code>.
      </span>
      <button
        type="button"
        data-testid="update-reload"
        // Bypasses the cached HTML shell that caused the mismatch.
        onClick={() => window.location.reload()}
        className="rounded-lg bg-sky-500 px-3 py-1.5 font-semibold text-slate-950 transition hover:bg-sky-400"
      >
        Reload
      </button>
    </div>
  )
}
