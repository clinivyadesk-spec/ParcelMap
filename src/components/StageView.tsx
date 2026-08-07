import { useEffect, useRef, useState } from 'react'
import { MapStage } from '../lib/stage.ts'
import { ASPECT_SIZES, type Scene } from '../lib/types.ts'

interface StageViewProps {
  scene: Scene
  onReady: (stage: MapStage) => void
  onDispose?: () => void
}

/**
 * Hosts the render stage. The stage always lives at true output resolution
 * (e.g. 1080x1920) and is scaled down with a CSS transform, so the preview is
 * literally the exported pixels rather than a separate small-screen rendering.
 */
export function StageView({ scene, onReady, onDispose }: StageViewProps) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<MapStage | null>(null)
  const [scale, setScale] = useState(0.2)
  // The stage is created asynchronously, so the fit may resolve before it
  // exists. Keep the latest value to apply the moment it is ready.
  const scaleRef = useRef(scale)
  const [error, setError] = useState<string | null>(null)

  // The scene the stage was first built with; later changes go through
  // stage.setScene() rather than a rebuild.
  const initialSceneRef = useRef(scene)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onDisposeRef = useRef(onDispose)
  onDisposeRef.current = onDispose

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return

    let disposed = false
    MapStage.create({ container: holder, scene: initialSceneRef.current })
      .then((stage) => {
        if (disposed) {
          stage.destroy()
          return
        }
        stageRef.current = stage
        stage.setDisplayScale(scaleRef.current)
        onReadyRef.current(stage)
      })
      .catch((err: unknown) => {
        console.error('[ParcelMap] failed to create stage', err)
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      disposed = true
      onDisposeRef.current?.()
      stageRef.current?.destroy()
      stageRef.current = null
    }
  }, [])

  const size = ASPECT_SIZES[scene.settings.aspect]

  // Fit the output-sized stage into whatever space the pane has.
  useEffect(() => {
    const holder = holderRef.current
    const parent = holder?.parentElement
    if (!holder || !parent) return

    const fit = () => {
      const box = parent.getBoundingClientRect()
      const available = {
        width: Math.max(120, box.width - 8),
        height: Math.max(120, box.height - 8),
      }
      const next = Math.min(available.width / size.width, available.height / size.height)
      const safe = next > 0 && Number.isFinite(next) ? next : 0.2
      scaleRef.current = safe
      setScale(safe)
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [size.width, size.height])

  useEffect(() => {
    stageRef.current?.setDisplayScale(scale)
  }, [scale])

  return (
    <div
      ref={holderRef}
      data-testid="stage-holder"
      className="relative overflow-hidden rounded-xl bg-slate-900 shadow-2xl ring-1 ring-white/10"
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-sm text-rose-300">
          {error}
        </div>
      )}
    </div>
  )
}
