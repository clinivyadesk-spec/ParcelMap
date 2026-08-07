/**
 * Codec probing and feature detection. Kept separate from the export loop so
 * the UI can gate on it at load time.
 */

/**
 * H.264 High @ 4.0 first (best quality/compatibility for 1080p), then a
 * Baseline profile that older decoders accept.
 */
export const DEFAULT_CODEC_CANDIDATES = ['avc1.640028', 'avc1.42001f'] as const

export interface WebCodecsSupport {
  supported: boolean
  reason?: string
}

/** Synchronous, load-time check for the APIs the exporter needs. */
export function detectWebCodecs(): WebCodecsSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'No window' }
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return {
      supported: false,
      reason:
        'This browser does not support WebCodecs, which ParcelMap needs to write an MP4. Please use Chrome or Edge.',
    }
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'WebCodecs requires a secure context. Open this page over HTTPS (or on localhost).',
    }
  }
  return { supported: true }
}

export interface CodecChoice {
  codec: string
  /** Track codec tag for the muxer. */
  muxerCodec: 'avc' | 'hevc' | 'vp9' | 'av1'
  config: VideoEncoderConfig
}

function muxerCodecFor(codec: string): CodecChoice['muxerCodec'] {
  if (codec.startsWith('avc1') || codec.startsWith('avc3')) return 'avc'
  if (codec.startsWith('hev1') || codec.startsWith('hvc1')) return 'hevc'
  if (codec.startsWith('vp09') || codec === 'vp9') return 'vp9'
  if (codec.startsWith('av01')) return 'av1'
  return 'avc'
}

export interface ProbeOptions {
  width: number
  height: number
  fps: number
  bitrate: number
  /** Overrides the probe order. Only the render tests pass this. */
  candidates?: readonly string[]
}

/**
 * Walk the candidate list and return the first codec the browser will
 * actually accept, asking it via `isConfigSupported` rather than guessing.
 */
export async function pickCodec(options: ProbeOptions): Promise<CodecChoice | null> {
  const { width, height, fps, bitrate } = options
  const candidates = options.candidates ?? DEFAULT_CODEC_CANDIDATES

  for (const codec of candidates) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: 'quality',
      // Chrome's software H.264 encoder is the reliable path here; hardware
      // encoders often refuse odd sizes or silently produce lower quality.
      hardwareAcceleration: 'no-preference',
    }
    try {
      const support = await VideoEncoder.isConfigSupported(config)
      if (support.supported) {
        return {
          codec,
          muxerCodec: muxerCodecFor(codec),
          config: (support.config as VideoEncoderConfig | undefined) ?? config,
        }
      }
    } catch {
      // An unparseable codec string throws; just try the next one.
    }
  }
  return null
}
