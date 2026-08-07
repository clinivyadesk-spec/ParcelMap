import { luminance, rgba, shade } from './color.ts'
import { clamp, clamp01, easeOutCubic, lerp } from './easing.ts'
import type { FrameState } from './timeline.ts'
import type { VideoSettings } from './types.ts'

export interface ProjectedLabel {
  /** Screen position of the marker this label belongs to, in output pixels. */
  x: number
  y: number
  text: string
  sub?: string
  /** 0..1 fade. */
  opacity: number
  /** 0..1 marker drop, used to slide the label in with the pin. */
  drop: number
}

export interface OverlayInput {
  width: number
  height: number
  settings: VideoSettings
  state: FrameState
  hubLabel: ProjectedLabel | null
  destinationLabels: ProjectedLabel[]
  destinationCount: number
  totalKm: number
  /**
   * Basemap credit, already flattened to plain text. MapLibre's own
   * attribution control is a DOM node and never lands in the WebGL canvas, so
   * it has to be drawn here to survive into the exported file.
   */
  attribution: string
}

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT_STACK}`
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where a chip actually ended up. Returned so tests can assert on layout. */
export interface PlacedLabel extends Rect {
  text: string
  variant: 'hub' | 'destination'
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** Vertical scrims so white text stays readable over a light basemap. */
function drawScrims(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const topHeight = h * 0.3
  const top = ctx.createLinearGradient(0, 0, 0, topHeight)
  top.addColorStop(0, 'rgba(6, 12, 24, 0.82)')
  top.addColorStop(0.6, 'rgba(6, 12, 24, 0.35)')
  top.addColorStop(1, 'rgba(6, 12, 24, 0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, w, topHeight)

  const bottomHeight = h * 0.28
  const bottom = ctx.createLinearGradient(0, h, 0, h - bottomHeight)
  bottom.addColorStop(0, 'rgba(6, 12, 24, 0.86)')
  bottom.addColorStop(0.55, 'rgba(6, 12, 24, 0.4)')
  bottom.addColorStop(1, 'rgba(6, 12, 24, 0)')
  ctx.fillStyle = bottom
  ctx.fillRect(0, h - bottomHeight, w, bottomHeight)
}

function drawTitle(ctx: CanvasRenderingContext2D, input: OverlayInput, scale: number): void {
  const { settings, state, width } = input
  const left = 64 * scale
  let y = 118 * scale

  if (settings.title) {
    ctx.save()
    ctx.globalAlpha = state.title
    ctx.translate(0, lerp(24 * scale, 0, state.title))
    ctx.fillStyle = '#ffffff'
    ctx.font = font(800, 58 * scale)
    ctx.textBaseline = 'alphabetic'
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 18 * scale
    ctx.fillText(settings.title, left, y, width - left * 2)
    ctx.restore()
    y += 54 * scale
  }

  if (settings.subtitle) {
    ctx.save()
    ctx.globalAlpha = state.subtitle
    ctx.translate(0, lerp(18 * scale, 0, state.subtitle))
    ctx.fillStyle = 'rgba(226, 240, 255, 0.88)'
    ctx.font = font(500, 30 * scale)
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 12 * scale
    ctx.fillText(settings.subtitle, left, y, width - left * 2)
    ctx.restore()
    y += 34 * scale
  }

  // Accent rule under the header, wiping in with the title.
  ctx.save()
  ctx.globalAlpha = state.title
  ctx.fillStyle = settings.arcColor
  ctx.fillRect(left, y - 8 * scale, 96 * scale * state.title, 6 * scale)
  ctx.restore()
}

/** Closest point on a rectangle's border to `p`, used to aim leader lines. */
function anchorOn(rect: Rect, px: number, py: number): { x: number; y: number } {
  const cx = clamp(px, rect.x, rect.x + rect.w)
  const cy = clamp(py, rect.y, rect.y + rect.h)
  // Push the anchor out to whichever edge is nearest.
  const dLeft = Math.abs(px - rect.x)
  const dRight = Math.abs(px - (rect.x + rect.w))
  const dTop = Math.abs(py - rect.y)
  const dBottom = Math.abs(py - (rect.y + rect.h))
  const min = Math.min(dLeft, dRight, dTop, dBottom)
  if (min === dLeft) return { x: rect.x, y: cy }
  if (min === dRight) return { x: rect.x + rect.w, y: cy }
  if (min === dTop) return { x: cx, y: rect.y }
  return { x: cx, y: rect.y + rect.h }
}

function drawPlaceLabel(
  ctx: CanvasRenderingContext2D,
  label: ProjectedLabel,
  input: OverlayInput,
  scale: number,
  occupied: Rect[],
  variant: 'hub' | 'destination',
): PlacedLabel | null {
  if (label.opacity <= 0.01) return null

  const isHub = variant === 'hub'
  const nameSize = (isHub ? 34 : 27) * scale
  const subSize = (isHub ? 22 : 20) * scale
  const padX = 16 * scale
  const padY = 10 * scale
  const gap = label.sub ? 5 * scale : 0

  ctx.font = font(isHub ? 800 : 700, nameSize)
  const nameWidth = ctx.measureText(label.text).width
  let subWidth = 0
  if (label.sub) {
    ctx.font = font(600, subSize)
    subWidth = ctx.measureText(label.sub).width
  }

  const boxW = Math.max(nameWidth, subWidth) + padX * 2
  const boxH = nameSize + (label.sub ? subSize + gap : 0) + padY * 2

  // Score every candidate slot and take the best. A greedy walk that stops at
  // the first free spot can run out of attempts and leave the chip sitting on
  // top of another one; scoring always yields the least-bad placement.
  const markerGap = (isHub ? 34 : 26) * scale
  const step = 10 * scale
  const minX = 20 * scale
  const maxX = Math.max(minX, input.width - boxW - 20 * scale)
  const minY = 12 * scale
  const maxY = Math.max(minY, input.height - boxH - 12 * scale)
  const preferLeft = label.x + markerGap + boxW > input.width - 24 * scale

  let best: Rect | null = null
  let bestScore = Infinity

  for (const side of preferLeft ? [-1, 1] : [1, -1]) {
    const candidateX = clamp(
      side === 1 ? label.x + markerGap : label.x - markerGap - boxW,
      minX,
      maxX,
    )
    for (let i = 0; i <= 32; i++) {
      // 0, +1, -1, +2, -2, ... in units of `step`.
      const dy = (i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1)) * step
      const candidate: Rect = {
        x: candidateX,
        y: clamp(label.y - boxH / 2 + dy, minY, maxY),
        w: boxW,
        h: boxH,
      }

      let overlapArea = 0
      for (const r of occupied) {
        const ox = Math.min(candidate.x + candidate.w, r.x + r.w) - Math.max(candidate.x, r.x)
        const oy = Math.min(candidate.y + candidate.h, r.y + r.h) - Math.max(candidate.y, r.y)
        if (ox > 0 && oy > 0) overlapArea += ox * oy
      }

      // Overlap dominates; distance from the marker only breaks ties.
      const distance = Math.hypot(
        candidate.x + boxW / 2 - label.x,
        candidate.y + boxH / 2 - label.y,
      )
      const score = overlapArea * 1000 + distance
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
      if (overlapArea === 0 && i === 0) break
    }
    if (bestScore < 1000) break
  }

  const rect: Rect = best ?? { x: clamp(label.x, minX, maxX), y: clamp(label.y, minY, maxY), w: boxW, h: boxH }
  const x = rect.x
  const y = rect.y
  const margin = 6 * scale
  occupied.push({
    x: rect.x - margin,
    y: rect.y - margin,
    w: rect.w + margin * 2,
    h: rect.h + margin * 2,
  })

  ctx.save()
  ctx.globalAlpha = label.opacity
  // Slide in from the marker as the pin lands.
  ctx.translate(0, lerp(10 * scale, 0, easeOutCubic(label.drop)))

  const accent = input.settings.arcColor

  // Leader line back to the marker, so a displaced chip still reads as
  // belonging to its pin.
  const anchor = anchorOn(rect, label.x, label.y)
  const leaderLength = Math.hypot(anchor.x - label.x, anchor.y - label.y)
  if (leaderLength > 4 * scale) {
    ctx.strokeStyle = rgba(accent, 0.75)
    ctx.lineWidth = 2 * scale
    ctx.setLineDash([6 * scale, 4 * scale])
    ctx.beginPath()
    ctx.moveTo(label.x, label.y)
    ctx.lineTo(anchor.x, anchor.y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (isHub) {
    ctx.fillStyle = accent
    ctx.shadowColor = rgba(accent, 0.5)
    ctx.shadowBlur = 22 * scale
  } else {
    ctx.fillStyle = 'rgba(10, 16, 28, 0.88)'
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 14 * scale
  }
  roundRect(ctx, x, y, boxW, boxH, 12 * scale)
  ctx.fill()
  ctx.shadowBlur = 0

  if (!isHub) {
    ctx.strokeStyle = rgba(accent, 0.55)
    ctx.lineWidth = 2 * scale
    roundRect(ctx, x, y, boxW, boxH, 12 * scale)
    ctx.stroke()
  }

  const onAccentIsDark = luminance(accent) > 0.6
  ctx.fillStyle = isHub ? (onAccentIsDark ? '#0b1220' : '#ffffff') : '#ffffff'
  ctx.textBaseline = 'top'
  ctx.font = font(isHub ? 800 : 700, nameSize)
  ctx.fillText(label.text, x + padX, y + padY)

  if (label.sub) {
    ctx.font = font(600, subSize)
    ctx.fillStyle = isHub
      ? onAccentIsDark
        ? 'rgba(11, 18, 32, 0.75)'
        : 'rgba(255,255,255,0.82)'
      : rgba(accent, 0.95)
    ctx.fillText(label.sub, x + padX, y + padY + nameSize + gap)
  }

  ctx.restore()
  return { text: label.text, variant, ...rect }
}

function drawCounter(ctx: CanvasRenderingContext2D, input: OverlayInput, scale: number): void {
  const { state, settings, width, height } = input
  if (state.counter.opacity <= 0.01) return

  const value = Math.round(state.counter.value)
  const numberSize = 128 * scale
  const left = 64 * scale
  const baseline = height - 132 * scale

  ctx.save()
  ctx.globalAlpha = state.counter.opacity
  ctx.translate(0, lerp(26 * scale, 0, state.counter.opacity))

  ctx.textBaseline = 'alphabetic'
  ctx.font = font(900, numberSize)
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = rgba(settings.arcColor, 0.55)
  ctx.shadowBlur = 30 * scale
  const numberText = String(value)
  ctx.fillText(numberText, left, baseline)
  const numberWidth = ctx.measureText(numberText).width
  ctx.shadowBlur = 0

  ctx.font = font(800, 30 * scale)
  ctx.fillStyle = settings.arcColor
  ctx.fillText('DESTINATIONS', left + numberWidth + 20 * scale, baseline - 44 * scale)

  ctx.font = font(600, 25 * scale)
  ctx.fillStyle = 'rgba(226, 240, 255, 0.8)'
  const kmText =
    input.totalKm > 0 ? `${Math.round(input.totalKm).toLocaleString('en-IN')} km of routes` : ''
  if (kmText) ctx.fillText(kmText, left + numberWidth + 20 * scale, baseline - 6 * scale)

  ctx.restore()
  void width
}

/** Basemap credit, baked into the frame so the exported MP4 carries it. */
function drawAttribution(
  ctx: CanvasRenderingContext2D,
  input: OverlayInput,
  scale: number,
): void {
  if (!input.attribution) return

  ctx.save()
  ctx.font = font(500, 17 * scale)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'right'

  const text = input.attribution
  const w = ctx.measureText(text).width
  const x = input.width - 20 * scale
  const y = input.height - 22 * scale

  ctx.fillStyle = 'rgba(6, 12, 24, 0.55)'
  roundRect(ctx, x - w - 14 * scale, y - 18 * scale, w + 20 * scale, 26 * scale, 6 * scale)
  ctx.fill()

  ctx.fillStyle = 'rgba(226, 240, 255, 0.72)'
  ctx.fillText(text, x - 4 * scale, y)
  ctx.restore()
}

function drawLogo(ctx: CanvasRenderingContext2D, input: OverlayInput, scale: number): void {
  const { settings, width, height, state } = input
  if (!settings.logoText) return

  ctx.save()
  // Sits above the attribution strip drawn below it.
  ctx.globalAlpha = 0.9 * clamp01(state.title)
  ctx.font = font(700, 24 * scale)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'right'
  const x = width - 28 * scale
  const y = height - 62 * scale

  const text = settings.logoText
  const w = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(10, 16, 28, 0.55)'
  roundRect(ctx, x - w - 16 * scale, y - 26 * scale, w + 24 * scale, 38 * scale, 10 * scale)
  ctx.fill()

  ctx.fillStyle = shade(settings.arcColor, 0.35)
  ctx.fillText(text, x - 4 * scale, y)
  ctx.restore()
}

function drawProgressBar(ctx: CanvasRenderingContext2D, input: OverlayInput, scale: number): void {
  const { width, height, state, settings } = input
  const h = 7 * scale
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(0, height - h, width, h)
  ctx.fillStyle = settings.arcColor
  ctx.fillRect(0, height - h, width * state.progress, h)
  ctx.restore()
}

/**
 * Draws every non-map element for one frame. Called with an identical input
 * by the live preview and by the export loop, which is what keeps the two
 * pixel-identical.
 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  input: OverlayInput,
): PlacedLabel[] {
  const { width, height } = input
  const scale = Math.min(width, height) / 1080

  ctx.clearRect(0, 0, width, height)
  ctx.textAlign = 'left'

  drawScrims(ctx, width, height)
  drawTitle(ctx, input, scale)

  // Keep chips off the markers themselves: every visible marker reserves a
  // small box before any label is placed.
  const occupied: Rect[] = []
  const markerKeepOut = 30 * scale
  const reserveMarker = (label: ProjectedLabel) => {
    occupied.push({
      x: label.x - markerKeepOut,
      y: label.y - markerKeepOut,
      w: markerKeepOut * 2,
      h: markerKeepOut * 2,
    })
  }
  if (input.hubLabel) reserveMarker(input.hubLabel)
  for (const label of input.destinationLabels) reserveMarker(label)

  // The hub claims its slot first so destination chips get nudged around it
  // rather than the other way round.
  const placed: PlacedLabel[] = []
  if (input.hubLabel) {
    const hub = drawPlaceLabel(ctx, input.hubLabel, input, scale, occupied, 'hub')
    if (hub) placed.push(hub)
  }
  // Place top-to-bottom so the packing is stable as more towns appear.
  const ordered = [...input.destinationLabels].sort((a, b) => a.y - b.y)
  for (const label of ordered) {
    const chip = drawPlaceLabel(ctx, label, input, scale, occupied, 'destination')
    if (chip) placed.push(chip)
  }

  drawCounter(ctx, input, scale)
  drawLogo(ctx, input, scale)
  drawAttribution(ctx, input, scale)
  drawProgressBar(ctx, input, scale)

  return placed
}
