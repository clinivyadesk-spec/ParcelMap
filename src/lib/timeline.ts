import { clamp01, easeInOutCubic, easeOutBack, easeOutCubic, span } from './easing.ts'

export const FPS = 30

/** Hub marker drop-in occupies frames 0..44. */
export const HUB_IN_FRAMES = 45
/** Hold at the end while the counter animates. */
export const OUTRO_FRAMES = 60
/** Pin drop + label fade after a parcel arrives. */
export const ARRIVAL_FRAMES = 12

export interface Leg {
  index: number
  /** Frame the arc starts drawing. */
  startFrame: number
  /** How long the arc takes to draw. */
  arcFrames: number
  /** Frame the parcel reaches the destination. */
  arriveFrame: number
}

export interface Timeline {
  fps: number
  totalFrames: number
  stagger: number
  legs: Leg[]
  /** Frame the final hold + counter begins. */
  outroStart: number
}

export function computeTimeline(
  destinationCount: number,
  secondsPerDestination: number,
  fps = FPS,
): Timeline {
  // One "second per destination" is the gap between reveals; the arc itself
  // takes twice that, so consecutive arcs overlap and the fan feels continuous.
  const stagger = Math.max(3, Math.round(secondsPerDestination * fps))
  const arcFrames = Math.max(6, stagger * 2)

  const legs: Leg[] = []
  for (let i = 0; i < destinationCount; i++) {
    const startFrame = HUB_IN_FRAMES + i * stagger
    legs.push({ index: i, startFrame, arcFrames, arriveFrame: startFrame + arcFrames })
  }

  const lastArrival = legs.length > 0 ? legs[legs.length - 1].arriveFrame : HUB_IN_FRAMES
  const outroStart = lastArrival + ARRIVAL_FRAMES

  return {
    fps,
    stagger,
    legs,
    outroStart,
    totalFrames: outroStart + OUTRO_FRAMES,
  }
}

export interface LegState {
  index: number
  /** Eased reveal along the arc, 0..1. */
  t: number
  /** Whether the arc has started drawing at all. */
  active: boolean
  /** Parcel dot rides the tip while the arc is drawing. */
  parcel: number
  /** Destination pin drop, 0..1. */
  pin: number
  /** Destination label fade, 0..1. */
  label: number
}

export interface FrameState {
  frame: number
  /** Position in the whole clip, 0..1. */
  progress: number
  hub: {
    drop: number
    label: number
    /** Expanding pulse ring, 0..1, restarts on a loop. */
    pulse: number
  }
  legs: LegState[]
  counter: {
    /** Animated value counting up to the destination count. */
    value: number
    opacity: number
  }
  title: number
  subtitle: number
}

const PULSE_PERIOD = 45

export function frameState(timeline: Timeline, frame: number): FrameState {
  const f = Math.max(0, Math.min(timeline.totalFrames - 1, Math.round(frame)))

  const hubDrop = easeOutBack(span(f, 0, 24))
  const hubLabel = easeOutCubic(span(f, 18, 18))
  const pulse = f < 8 ? 0 : ((f - 8) % PULSE_PERIOD) / PULSE_PERIOD

  const legs: LegState[] = timeline.legs.map((leg) => {
    const raw = span(f, leg.startFrame, leg.arcFrames)
    const t = easeInOutCubic(raw)
    const arrivalProgress = span(f, leg.arriveFrame, ARRIVAL_FRAMES)
    return {
      index: leg.index,
      t,
      active: f >= leg.startFrame,
      // The parcel rides the tip while drawing, then fades as the pin lands.
      parcel: f >= leg.startFrame && raw < 1 ? 1 : 1 - clamp01(arrivalProgress * 2),
      pin: easeOutBack(arrivalProgress),
      label: easeOutCubic(span(f, leg.arriveFrame + 3, ARRIVAL_FRAMES)),
    }
  })

  const counterProgress = easeOutCubic(span(f, timeline.outroStart, 40))

  return {
    frame: f,
    progress: timeline.totalFrames > 1 ? f / (timeline.totalFrames - 1) : 0,
    hub: { drop: hubDrop, label: hubLabel, pulse },
    legs,
    counter: {
      value: counterProgress * timeline.legs.length,
      opacity: easeOutCubic(span(f, timeline.outroStart, 12)),
    },
    title: easeOutCubic(span(f, 4, 20)),
    subtitle: easeOutCubic(span(f, 12, 20)),
  }
}

export function formatDuration(frames: number, fps = FPS): string {
  const totalSeconds = frames / fps
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds - m * 60
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`
}
