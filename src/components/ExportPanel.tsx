import { useCallback, useEffect, useRef, useState } from 'react'
import { codecOverride, frameCapOverride } from '../lib/devFlags.ts'
import { downloadResult, exportVideo, type ExportProgress, type ExportResult } from '../lib/export.ts'
import type { MapStage } from '../lib/stage.ts'
import { FPS, formatDuration } from '../lib/timeline.ts'
import { detectWebCodecs } from '../lib/webcodecs.ts'

interface ExportPanelProps {
  stage: MapStage | null
  /** Blocks rendering while the scene is incomplete. */
  disabledReason?: string | null
  onRenderingChange?: (rendering: boolean) => void
}

function formatEta(seconds: number | null): string {
  if (seconds == null) return 'estimating…'
  if (seconds < 60) return `${Math.ceil(seconds)}s left`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds - m * 60)
  return `${m}m ${String(s).padStart(2, '0')}s left`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExportPanel({ stage, disabledReason, onRenderingChange }: ExportPanelProps) {
  const [support] = useState(() => detectWebCodecs())
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const rendering = progress != null && progress.phase !== 'done'

  useEffect(() => {
    onRenderingChange?.(rendering)
  }, [rendering, onRenderingChange])

  useEffect(() => () => abortRef.current?.abort(), [])

  const handleRender = useCallback(async () => {
    if (!stage) return
    setError(null)
    setResult(null)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const output = await exportVideo({
        stage,
        signal: controller.signal,
        codecCandidates: codecOverride() ?? undefined,
        maxFrames: frameCapOverride() ?? undefined,
        onProgress: setProgress,
      })
      setResult(output)
      downloadResult(output)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
      abortRef.current = null
      // The preview restores its own scrub position once rendering clears.
    }
  }, [stage])

  if (!support.supported) {
    return (
      <div
        data-testid="webcodecs-unsupported"
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200"
      >
        <p className="font-semibold">MP4 export unavailable</p>
        <p className="mt-1 text-amber-200/80">{support.reason}</p>
      </div>
    )
  }

  const totalFrames = stage?.getTimeline().totalFrames ?? 0
  const blocked = disabledReason ?? (stage ? null : 'Preview still loading…')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="render-button"
          onClick={handleRender}
          disabled={rendering || blocked != null}
          className="flex-1 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {rendering ? 'Rendering…' : 'Render MP4'}
        </button>
        {rendering && (
          <button
            type="button"
            data-testid="cancel-render"
            onClick={() => abortRef.current?.abort()}
            className="rounded-lg border border-white/15 px-3 py-2.5 text-sm text-slate-300 transition hover:bg-white/5"
          >
            Cancel
          </button>
        )}
      </div>

      {blocked && !rendering && <p className="text-xs text-slate-500">{blocked}</p>}

      {!rendering && !result && !blocked && (
        <p className="text-xs leading-relaxed text-slate-500">
          {totalFrames} frames at {FPS}fps ({formatDuration(totalFrames)}). Rendering takes roughly
          1–3 minutes and encodes frame by frame, so keep this tab focused and in the foreground
          until it finishes.
        </p>
      )}

      {progress && (
        <div data-testid="export-progress" className="space-y-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-sky-400 transition-[width] duration-150"
              style={{
                width: `${((progress.frame / Math.max(1, progress.totalFrames)) * 100).toFixed(1)}%`,
              }}
            />
          </div>
          <div className="flex justify-between font-mono text-[11px] text-slate-400">
            <span data-testid="export-frame-count">
              {progress.phase === 'finalising'
                ? 'writing MP4…'
                : `frame ${progress.frame}/${progress.totalFrames}`}
            </span>
            <span>{formatEta(progress.etaSeconds)}</span>
          </div>
        </div>
      )}

      {error && (
        <p data-testid="export-error" className="rounded-md bg-rose-500/10 p-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {result && (
        <div
          data-testid="export-done"
          className="rounded-md bg-emerald-500/10 p-3 text-xs text-emerald-200"
        >
          <p className="font-semibold">{result.filename}</p>
          <p className="mt-1 text-emerald-200/75">
            {result.frames} frames · {result.durationSeconds.toFixed(1)}s ·{' '}
            {formatBytes(result.bytes)} · {result.codec} · rendered in{' '}
            {result.elapsedSeconds.toFixed(0)}s
          </p>
          <button
            type="button"
            data-testid="download-again"
            onClick={() => downloadResult(result)}
            className="mt-2 rounded border border-emerald-400/40 px-2 py-1 text-emerald-200 transition hover:bg-emerald-400/10"
          >
            Download again
          </button>
        </div>
      )}
    </div>
  )
}
