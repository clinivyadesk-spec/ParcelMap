import { useCallback, useEffect, useRef, useState } from 'react'
import { StageView } from './StageView.tsx'
import type { MapStage } from '../lib/stage.ts'
import { FPS, formatDuration } from '../lib/timeline.ts'
import type { Scene } from '../lib/types.ts'

interface PreviewProps {
  scene: Scene
  /** Handed the stage once it exists, so the export can drive the same object. */
  onStageReady?: (stage: MapStage | null) => void
  disabled?: boolean
}

/**
 * Scrubbable preview. Playback and scrubbing both go through
 * `stage.renderFrame`, which is the exact function the exporter calls, so
 * what you see here is what lands in the MP4.
 */
export function Preview({ scene, onStageReady, disabled }: PreviewProps) {
  const stageRef = useRef<MapStage | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [totalFrames, setTotalFrames] = useState(1)
  const frameRef = useRef(0)

  const onStageReadyRef = useRef(onStageReady)
  onStageReadyRef.current = onStageReady

  const handleReady = useCallback((stage: MapStage) => {
    stageRef.current = stage
    setTotalFrames(stage.getTimeline().totalFrames)
    stage.renderFrame(0)
    onStageReadyRef.current?.(stage)
    // Test hook: lets the headless render checks drive frames directly.
    ;(window as unknown as { __stage?: MapStage }).__stage = stage
  }, [])

  const handleDispose = useCallback(() => {
    stageRef.current = null
    onStageReadyRef.current?.(null)
  }, [])

  // Push scene edits into the existing stage rather than rebuilding the map.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.setScene(scene)
    const total = stage.getTimeline().totalFrames
    setTotalFrames(total)
    const clamped = Math.min(frameRef.current, total - 1)
    frameRef.current = clamped
    setFrame(clamped)
    stage.renderFrame(clamped)
  }, [scene])

  // The exporter drives the stage directly while it runs, leaving it on the
  // last frame it encoded. Put the preview back where the user left it once
  // control returns.
  useEffect(() => {
    if (disabled) return
    stageRef.current?.renderFrame(frameRef.current)
  }, [disabled])

  const applyFrame = useCallback((next: number) => {
    const stage = stageRef.current
    if (!stage) return
    const clamped = Math.max(0, Math.min(stage.getTimeline().totalFrames - 1, Math.round(next)))
    frameRef.current = clamped
    setFrame(clamped)
    stage.renderFrame(clamped)
  }, [])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const startedAt = performance.now()
    const startFrame = frameRef.current

    const tick = (now: number) => {
      const stage = stageRef.current
      if (!stage) return
      const total = stage.getTimeline().totalFrames
      const elapsed = ((now - startedAt) / 1000) * FPS
      const next = startFrame + elapsed

      if (next >= total - 1) {
        applyFrame(total - 1)
        setPlaying(false)
        return
      }
      applyFrame(next)
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, applyFrame])

  const togglePlay = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    // Restarting from the end should replay from the top.
    if (frameRef.current >= stage.getTimeline().totalFrames - 1) applyFrame(0)
    setPlaying((p) => !p)
  }, [applyFrame])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-3">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <StageView scene={scene} onReady={handleReady} onDispose={handleDispose} />
      </div>

      <div className="flex w-full max-w-md shrink-0 items-center gap-3 rounded-lg bg-slate-900/70 px-3 py-2 ring-1 ring-white/10">
        <button
          type="button"
          onClick={togglePlay}
          disabled={disabled}
          data-testid="play-toggle"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-slate-950 transition hover:bg-sky-400 disabled:opacity-40"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-current">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={frame}
          disabled={disabled}
          data-testid="frame-slider"
          onChange={(e) => {
            setPlaying(false)
            applyFrame(Number(e.target.value))
          }}
          className="min-w-0 flex-1"
          aria-label="Timeline"
        />

        <span
          data-testid="frame-readout"
          className="shrink-0 font-mono text-xs tabular-nums text-slate-400"
        >
          {frame}/{totalFrames - 1} · {formatDuration(frame)}
        </span>
      </div>
    </div>
  )
}
