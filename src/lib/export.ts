import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import type { MapStage } from './stage.ts'
import { FPS } from './timeline.ts'
import { pickCodec } from './webcodecs.ts'

export const EXPORT_BITRATE = 8_000_000

/** How many encodes may be in flight before we wait for the queue to drain. */
const MAX_QUEUE_DEPTH = 8
/** Key frame cadence, in frames. */
const KEYFRAME_INTERVAL = 60

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'finalising' | 'done'
  frame: number
  totalFrames: number
  /** Seconds remaining, or null before there is enough data to estimate. */
  etaSeconds: number | null
  fps: number
}

export interface ExportOptions {
  stage: MapStage
  fps?: number
  bitrate?: number
  /** Overrides the codec probe order. Only the render tests pass this. */
  codecCandidates?: readonly string[]
  /** Caps the clip length, for quick test renders. */
  maxFrames?: number
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export interface ExportResult {
  blob: Blob
  filename: string
  frames: number
  durationSeconds: number
  codec: string
  bytes: number
  /** Wall-clock time the render took. */
  elapsedSeconds: number
}

export class ExportError extends Error {}

/**
 * Wait for the map to have nothing left to paint. The stage forces a
 * synchronous redraw first, so this terminates even in a throttled tab.
 */
async function waitForMapIdle(stage: MapStage, timeoutMs = 2000): Promise<void> {
  await stage.settle(timeoutMs)
}

/**
 * Let the encoder drain to `target` before queueing more work. Prefers the
 * `dequeue` event over `flush()`: flushing mid-stream forces the encoder to
 * emit everything it holds, which costs compression efficiency.
 */
async function awaitQueueDepth(
  encoder: VideoEncoder,
  target: number,
  timeoutMs = 10_000,
): Promise<void> {
  if (encoder.encodeQueueSize <= target) return

  if (typeof encoder.addEventListener !== 'function' || !('ondequeue' in encoder)) {
    await encoder.flush()
    return
  }

  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      encoder.removeEventListener('dequeue', onDequeue)
      resolve()
    }
    const onDequeue = () => {
      if (encoder.encodeQueueSize <= target) finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    encoder.addEventListener('dequeue', onDequeue)
    onDequeue()
  })
}

function suggestFilename(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'parcelmap'
  const stamp = new Date().toISOString().slice(0, 10)
  return `${slug}-${stamp}.mp4`
}

/**
 * Render the clip one frame at a time and mux it into an MP4.
 *
 * This is deliberately not real-time: each iteration updates the sources,
 * jumps the camera, waits for the map to finish painting, then grabs the
 * pixels. A dropped tile would otherwise show up as a blank frame.
 */
export async function exportVideo(options: ExportOptions): Promise<ExportResult> {
  const { stage, onProgress, signal } = options
  const fps = options.fps ?? FPS
  const bitrate = options.bitrate ?? EXPORT_BITRATE

  const width = stage.width
  const height = stage.height
  const timeline = stage.getTimeline()
  const totalFrames = Math.min(timeline.totalFrames, options.maxFrames ?? Infinity)

  const report = (progress: Partial<ExportProgress> & Pick<ExportProgress, 'phase' | 'frame'>) => {
    onProgress?.({ totalFrames, etaSeconds: null, fps, ...progress })
  }

  report({ phase: 'preparing', frame: 0 })

  const choice = await pickCodec({
    width,
    height,
    fps,
    bitrate,
    candidates: options.codecCandidates,
  })
  if (!choice) {
    throw new ExportError(
      'No supported H.264 encoder was found in this browser. Chrome or Edge on desktop is required.',
    )
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: choice.muxerCodec, width, height, frameRate: fps },
    fastStart: 'in-memory',
  })

  let encoderError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err))
    },
  })
  encoder.configure(choice.config)

  // Scratch canvas we composite map + overlay into, at exact output size.
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d', { alpha: false })
  if (!ctx) throw new ExportError('Could not create the 2D compositing canvas')

  const startedAt = performance.now()
  let encoded = 0

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new ExportError('Export cancelled')
      if (encoderError) throw encoderError

      // 1. Advance every animated source and the camera to this frame.
      stage.renderFrame(i)

      // 2. Let the map finish drawing before we read its pixels.
      await waitForMapIdle(stage, 2000)

      // 3. Composite map canvas + overlay canvas.
      stage.composite(ctx)

      // 4. Hand the frame to the encoder.
      const frame = new VideoFrame(out, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      })
      try {
        encoder.encode(frame, { keyFrame: i % KEYFRAME_INTERVAL === 0 })
      } finally {
        frame.close()
      }
      encoded++

      // 5. Backpressure: let the encoder catch up rather than queueing the
      //    whole clip into memory.
      if (encoder.encodeQueueSize > MAX_QUEUE_DEPTH) {
        await awaitQueueDepth(encoder, MAX_QUEUE_DEPTH / 2)
        if (encoderError) throw encoderError
      }

      const elapsed = (performance.now() - startedAt) / 1000
      const perFrame = elapsed / (i + 1)
      report({
        phase: 'rendering',
        frame: i + 1,
        etaSeconds: i > 2 ? Math.max(0, perFrame * (totalFrames - i - 1)) : null,
      })
    }

    report({ phase: 'finalising', frame: totalFrames })
    await encoder.flush()
    if (encoderError) throw encoderError
    muxer.finalize()
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }

  const buffer = muxer.target.buffer
  if (!buffer || buffer.byteLength === 0) {
    throw new ExportError('The muxer produced an empty file')
  }

  const blob = new Blob([buffer], { type: 'video/mp4' })
  const elapsedSeconds = (performance.now() - startedAt) / 1000

  report({ phase: 'done', frame: totalFrames, etaSeconds: 0 })

  return {
    blob,
    filename: suggestFilename(stage.getScene().settings.title),
    frames: encoded,
    durationSeconds: encoded / fps,
    codec: choice.codec,
    bytes: blob.size,
    elapsedSeconds,
  }
}

/** Trigger a browser download for a finished export. */
export function downloadResult(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = result.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the download a moment to start before dropping the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
