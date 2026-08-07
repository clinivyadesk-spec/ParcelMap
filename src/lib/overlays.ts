import { luminance, rgba, shade } from './color'
import { clamp, clamp01, easeOutCubic, lerp } from './easing'
import type { FrameState } from './timeline'
import type { VideoSettings } from './types'

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

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
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

function drawPlaceLabel(
  ctx: CanvasRenderingContext2D,
  label: ProjectedLabel,
  input: OverlayInput,
  scale: number,
  occupied: Rect[],
  variant: 'hub' | 'destination',
): void {
  if (label.opacity <= 0.01) return

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

  // Prefer sitting above-right of the marker, flip when close to an edge.
  const markerGap = (isHub ? 30 : 22) * scale
  let x = label.x + markerGap
  if (x + boxW > input.width - 24 * scale) x = label.x - markerGap - boxW
  x = clamp(x, 20 * scale, Math.max(20 * scale, input.width - boxW - 20 * scale))

  let y = label.y - boxH / 2
  const rect: Rect = { x, y, w: boxW, h: boxH }

  // Greedy de-overlap: nudge down, then up, until it finds a free slot.
  const step = 8 * scale
  for (let attempt = 0; attempt < 24; attempt++) {
    if (!occupied.some((r) => overlaps(rect, r))) break
    const dir = attempt % 2 === 0 ? 1 : -1
    const magnitude = Math.ceil((attempt + 1) / 2) * step * 2
    rect.y = y + dir * magnitude
  }
  y = clamp(rect.y, 12 * scale, input.height - boxH - 12 * scale)
  rect.y = y
  occupied.push({ x: rect.x - 4, y: rect.y - 4, w: rect.w + 8, h: rect.h + 8 })

  ctx.save()
  ctx.globalAlpha = label.opacity
  // Slide in from the marker as the pin lands.
  const slide = lerp(10 * scale, 0, easeOutCubic(label.drop))
  ctx.translate(0, slide)

  const accent = input.settings.arcColor
  if (isHub) {
    ctx.fillStyle = accent
    ctx.shadowColor = rgba(accent, 0.5)
    ctx.shadowBlur = 22 * scale
  } else {
    ctx.fillStyle = 'rgba(10, 16, 28, 0.86)'
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

function drawLogo(ctx: CanvasRenderingContext2D, input: OverlayInput, scale: number): void {
  const { settings, width, height, state } = input
  if (!settings.logoText) return

  ctx.save()
  // Sits above MapLibre's attribution strip, which we deliberately keep visible.
  ctx.globalAlpha = 0.9 * clamp01(state.title)
  ctx.font = font(700, 24 * scale)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'right'
  const x = width - 28 * scale
  const y = height - 52 * scale

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
export function drawOverlays(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { width, height } = input
  const scale = Math.min(width, height) / 1080

  ctx.clearRect(0, 0, width, height)
  ctx.textAlign = 'left'

  drawScrims(ctx, width, height)
  drawTitle(ctx, input, scale)

  // The hub claims its slot first so destination chips get nudged around it
  // rather than the other way round.
  const occupied: Rect[] = []
  if (input.hubLabel) {
    drawPlaceLabel(ctx, input.hubLabel, input, scale, occupied, 'hub')
  }
  for (const label of input.destinationLabels) {
    drawPlaceLabel(ctx, label, input, scale, occupied, 'destination')
  }

  drawCounter(ctx, input, scale)
  drawLogo(ctx, input, scale)
  drawProgressBar(ctx, input, scale)
}
