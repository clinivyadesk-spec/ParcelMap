import {
  GeoJSONSource,
  LngLat,
  Map as MapLibreMap,
  type StyleSpecification,
} from 'maplibre-gl'
import { rgba, shade } from './color.ts'
import { clamp, clamp01, lerp } from './easing.ts'
import { boundsOf, buildArc, sliceArc, type Arc } from './geo.ts'
import { drawOverlays, type PlacedLabel, type ProjectedLabel } from './overlays.ts'
import { installMapLibreWorker } from './maplibreWorker.ts'
import { offlineStyle, resolveStyle } from './mapStyles.ts'
import { computeTimeline, frameState, type FrameState, type Timeline } from './timeline.ts'
import { ASPECT_SIZES, type AspectRatio, type MapStyleId, type Scene } from './types.ts'

const SRC_ARCS = 'pm-arcs'
const SRC_PARCELS = 'pm-parcels'
const SRC_PINS = 'pm-pins'
const SRC_HUB = 'pm-hub'
const SRC_PULSE = 'pm-pulse'

type FC = GeoJSON.FeatureCollection

const EMPTY: FC = { type: 'FeatureCollection', features: [] }

/** Per-scene geometry, computed once and reused for every frame. */
interface Geometry {
  arcs: Arc[]
  totalKm: number
}

export interface CameraState {
  center: [number, number]
  zoom: number
}

export interface StageInit {
  container: HTMLElement
  scene: Scene
}

/**
 * How much wider the view gets across the whole clip when camera drift is on.
 *
 * This was 1.05 originally. At 5% each edge of a 1080px frame moves 27px over
 * a ten-second clip — roughly 2px per second, which nobody can see, so the
 * toggle read as broken. 1.15 is a drift you actually notice without it
 * competing with the arcs for attention.
 */
export const ZOOM_OUT_SCALE = 1.15

/** Camera padding as a fraction of each dimension, per aspect ratio. */
const CAMERA_PADDING: Record<AspectRatio, { top: number; bottom: number; left: number; right: number }> = {
  '9:16': { top: 0.22, bottom: 0.22, left: 0.06, right: 0.06 },
  '1:1': { top: 0.17, bottom: 0.19, left: 0.07, right: 0.07 },
  '16:9': { top: 0.14, bottom: 0.14, left: 0.26, right: 0.08 },
}

/**
 * Owns the MapLibre instance and the overlay canvas, and turns a frame number
 * into pixels. The live preview and the MP4 export both drive this same
 * object, so what you scrub is what you export.
 */
export class MapStage {
  readonly map: MapLibreMap
  readonly overlay: HTMLCanvasElement
  /** Output-sized wrapper. Scaled with a CSS transform to fit the preview pane. */
  readonly root: HTMLElement
  private readonly overlayCtx: CanvasRenderingContext2D
  private readonly mapHost: HTMLElement

  private scene: Scene
  private geometry: Geometry
  private timeline: Timeline
  private baseCamera: CameraState
  private destroyed = false
  private lastFrame = -1
  /** True when the requested basemap was unreachable and we fell back. */
  usedFallbackStyle = false
  private lastLabelLayout: PlacedLabel[] = []
  /** Last payload pushed to each source, so unchanged frames skip setData. */
  private lastSourceData = new Map<string, string>()
  /** Guards against an in-flight style swap being overtaken by a newer one. */
  private styleEpoch = 0

  width: number
  height: number

  private constructor(
    init: StageInit,
    map: MapLibreMap,
    overlay: HTMLCanvasElement,
    host: HTMLElement,
    root: HTMLElement,
  ) {
    this.scene = init.scene
    const size = ASPECT_SIZES[init.scene.settings.aspect]
    this.width = size.width
    this.height = size.height
    this.map = map
    this.overlay = overlay
    this.mapHost = host
    this.root = root
    const ctx = overlay.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.overlayCtx = ctx
    this.geometry = buildGeometry(init.scene)
    this.timeline = computeTimeline(
      init.scene.destinations.length,
      init.scene.settings.secondsPerDestination,
    )
    this.baseCamera = { center: [init.scene.origin.lng, init.scene.origin.lat], zoom: 6 }
  }

  static async create(init: StageInit): Promise<MapStage> {
    installMapLibreWorker()
    const size = ASPECT_SIZES[init.scene.settings.aspect]

    const root = document.createElement('div')
    root.className = 'stage-root'
    root.style.cssText = `position:relative;width:${size.width}px;height:${size.height}px;transform-origin:top left;`

    const mapHost = document.createElement('div')
    mapHost.style.cssText = `position:absolute;inset:0;width:${size.width}px;height:${size.height}px;`
    root.appendChild(mapHost)

    const overlay = document.createElement('canvas')
    overlay.width = size.width
    overlay.height = size.height
    overlay.style.cssText = `position:absolute;inset:0;width:${size.width}px;height:${size.height}px;pointer-events:none;z-index:2;`
    root.appendChild(overlay)

    init.container.appendChild(root)

    const map = new MapLibreMap({
      container: mapHost,
      style: resolveStyle(init.scene.settings.mapStyle),
      center: [init.scene.origin.lng, init.scene.origin.lat],
      zoom: 6,
      // Everything below is required for deterministic offscreen capture.
      // preserveDrawingBuffer keeps the WebGL backbuffer readable after the
      // paint, which is what lets us drawImage() the map canvas per frame.
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
        antialias: true,
        contextType: 'webgl2',
      },
      fadeDuration: 0,
      interactive: false,
      attributionControl: { compact: false },
      // Force a 1:1 backing store so getCanvas() is exactly the output size,
      // regardless of the user's display density.
      pixelRatio: 1,
      refreshExpiredTiles: false,
    })

    const stage = new MapStage(init, map, overlay, mapHost, root)
    await stage.whenStyleLoaded()
    stage.installLayers()
    stage.setScene(init.scene)
    return stage
  }

  /**
   * Resolve once the style is genuinely usable. If the remote style host is
   * unreachable we swap in the bundled offline style rather than leaving the
   * user with a dead grey rectangle.
   */
  private async whenStyleLoaded(timeoutMs = 20000): Promise<void> {
    const settled = await this.awaitStyle(timeoutMs)
    if (settled) return

    if (this.scene.settings.mapStyle !== 'offline') {
      console.warn('[ParcelMap] basemap style failed to load; falling back to the offline grid')
      this.usedFallbackStyle = true
      this.map.setStyle(offlineStyle())
      await this.awaitStyle(10000)
    }
  }

  private awaitStyle(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.map.isStyleLoaded()) {
        resolve(true)
        return
      }

      const cleanup = () => {
        clearTimeout(timer)
        clearInterval(poll)
        this.map.off('error', onError)
      }
      const succeed = () => {
        cleanup()
        resolve(true)
      }
      const onError = (event: { error?: Error }) => {
        // Individual tile 404s are survivable; only log them.
        console.warn('[ParcelMap] map error:', event?.error?.message ?? event)
      }

      const timer = setTimeout(() => {
        cleanup()
        resolve(this.map.isStyleLoaded() === true)
      }, timeoutMs)

      // `load` can be missed if it fired between construction and here, so
      // poll isStyleLoaded() as well.
      const poll = setInterval(() => {
        if (this.map.isStyleLoaded()) succeed()
      }, 60)

      this.map.on('error', onError)
      this.map.once('load', succeed)
    })
  }

  private installLayers(): void {
    const map = this.map
    this.lastSourceData.clear()
    for (const id of [SRC_PULSE, SRC_ARCS, SRC_PARCELS, SRC_PINS, SRC_HUB]) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY as never })
    }

    if (!map.getLayer('pm-pulse-ring')) {
      map.addLayer({
        id: 'pm-pulse-ring',
        type: 'circle',
        source: SRC_PULSE,
        paint: {
          'circle-radius': ['get', 'r'],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': ['get', 'w'],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': ['get', 'opacity'],
          'circle-opacity': 0,
        },
      })
    }

    // Wide soft pass under the crisp line gives the arcs a glow without
    // needing a blur filter.
    if (!map.getLayer('pm-arc-glow')) {
      map.addLayer({
        id: 'pm-arc-glow',
        type: 'line',
        source: SRC_ARCS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'glow'],
          'line-width': ['get', 'glowWidth'],
          'line-opacity': ['get', 'glowOpacity'],
          'line-blur': 6,
        },
      })
    }

    if (!map.getLayer('pm-arc-line')) {
      map.addLayer({
        id: 'pm-arc-line',
        type: 'line',
        source: SRC_ARCS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
        },
      })
    }

    if (!map.getLayer('pm-pin-halo')) {
      map.addLayer({
        id: 'pm-pin-halo',
        type: 'circle',
        source: SRC_PINS,
        paint: {
          'circle-radius': ['get', 'halo'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'haloOpacity'],
        },
      })
    }

    if (!map.getLayer('pm-pin')) {
      map.addLayer({
        id: 'pm-pin',
        type: 'circle',
        source: SRC_PINS,
        paint: {
          'circle-radius': ['get', 'r'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-width': ['get', 'stroke'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': ['get', 'opacity'],
        },
      })
    }

    if (!map.getLayer('pm-parcel')) {
      map.addLayer({
        id: 'pm-parcel',
        type: 'circle',
        source: SRC_PARCELS,
        paint: {
          'circle-radius': ['get', 'r'],
          'circle-color': '#ffffff',
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-width': 4,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': ['get', 'opacity'],
        },
      })
    }

    if (!map.getLayer('pm-hub-outer')) {
      map.addLayer({
        id: 'pm-hub-outer',
        type: 'circle',
        source: SRC_HUB,
        paint: {
          'circle-radius': ['get', 'outer'],
          'circle-color': '#ffffff',
          'circle-opacity': ['get', 'opacity'],
        },
      })
    }

    if (!map.getLayer('pm-hub-inner')) {
      map.addLayer({
        id: 'pm-hub-inner',
        type: 'circle',
        source: SRC_HUB,
        paint: {
          'circle-radius': ['get', 'inner'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
        },
      })
    }
  }

  /** Swap in new places/settings and recompute geometry, timeline and camera. */
  setScene(scene: Scene): void {
    const aspectChanged = scene.settings.aspect !== this.scene.settings.aspect
    const styleChanged = scene.settings.mapStyle !== this.scene.settings.mapStyle
    this.scene = scene
    this.geometry = buildGeometry(scene)
    this.timeline = computeTimeline(
      scene.destinations.length,
      scene.settings.secondsPerDestination,
    )

    if (aspectChanged) this.applySize(ASPECT_SIZES[scene.settings.aspect])

    this.recomputeCamera()

    if (styleChanged) {
      // Hold onto where the user was before the swap resets our bookkeeping.
      const restoreFrame = this.lastFrame < 0 ? 0 : this.lastFrame
      void this.swapStyle(scene.settings.mapStyle, restoreFrame)
    }

    this.lastFrame = -1
  }

  /**
   * Replace the basemap and rebuild our layers on top of it. Waits for the
   * new style to be genuinely loaded — `styledata` fires while the style is
   * still settling, and addSource() throws if called too early — then returns
   * the preview to the frame the user was looking at.
   */
  private async swapStyle(id: MapStyleId, restoreFrame: number): Promise<void> {
    this.styleEpoch += 1
    const epoch = this.styleEpoch

    this.map.setStyle(resolveStyle(id))
    const loaded = await this.awaitStyle(20000)

    // A newer swap started while we were waiting; let that one finish.
    if (this.destroyed || epoch !== this.styleEpoch) return

    if (!loaded && id !== 'offline') {
      console.warn('[ParcelMap] basemap style failed to load; falling back to the offline grid')
      this.usedFallbackStyle = true
      this.map.setStyle(offlineStyle())
      await this.awaitStyle(10000)
      if (this.destroyed || epoch !== this.styleEpoch) return
    } else if (loaded) {
      this.usedFallbackStyle = false
    }

    this.lastSourceData.clear()
    this.installLayers()
    this.renderFrame(Math.min(restoreFrame, this.timeline.totalFrames - 1))
  }

  /** Scale the output-sized stage down to fit the preview pane. */
  setDisplayScale(scale: number): void {
    this.root.style.transform = `scale(${scale})`
  }

  private applySize(size: { width: number; height: number }): void {
    this.width = size.width
    this.height = size.height
    this.root.style.width = `${size.width}px`
    this.root.style.height = `${size.height}px`
    this.mapHost.style.width = `${size.width}px`
    this.mapHost.style.height = `${size.height}px`
    this.overlay.width = size.width
    this.overlay.height = size.height
    this.overlay.style.width = `${size.width}px`
    this.overlay.style.height = `${size.height}px`
    this.map.resize()
  }

  private recomputeCamera(): void {
    const places = [this.scene.origin, ...this.scene.destinations]
    const bounds = boundsOf(places)
    if (!bounds) return

    // Reserve the zones the overlays live in: the title band at the top and
    // the counter band at the bottom. In 16:9 both sit on the left, so the
    // geography is pushed right instead.
    const fractions = CAMERA_PADDING[this.scene.settings.aspect]
    const padding = {
      top: Math.round(this.height * fractions.top),
      bottom: Math.round(this.height * fractions.bottom),
      left: Math.round(this.width * fractions.left),
      right: Math.round(this.width * fractions.right),
    }

    const camera = this.map.cameraForBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      { padding },
    )

    if (camera && camera.center !== undefined && Number.isFinite(camera.zoom)) {
      const center = LngLat.convert(camera.center)
      this.baseCamera = {
        center: [center.lng, center.lat],
        zoom: clamp(camera.zoom as number, 1, 15),
      }
    } else {
      this.baseCamera = {
        center: [this.scene.origin.lng, this.scene.origin.lat],
        zoom: 6,
      }
    }
  }

  getTimeline(): Timeline {
    return this.timeline
  }

  getScene(): Scene {
    return this.scene
  }

  /**
   * Camera for a given frame. Static by default — the whole point is that the
   * basemap does not drift while the arcs animate.
   *
   * With the drift toggle on, the camera starts at the fitted view and widens
   * to {@link ZOOM_OUT_SCALE} by the last frame. Widening (rather than
   * starting tight and pulling back to the fit) means every frame is at least
   * as wide as the fitted view, so a destination can never be clipped as it
   * lands.
   */
  cameraAt(frame: number): CameraState {
    if (!this.scene.settings.slowZoomOut) return this.baseCamera
    const total = Math.max(1, this.timeline.totalFrames - 1)
    const t = clamp01(frame / total)
    return {
      center: this.baseCamera.center,
      zoom: this.baseCamera.zoom - Math.log2(ZOOM_OUT_SCALE) * t,
    }
  }

  /** Update every animated source for `frame`. */
  updateSources(frame: number): FrameState {
    const state = frameState(this.timeline, frame)
    const { settings, origin, destinations } = this.scene
    const accent = settings.arcColor

    const arcFeatures: GeoJSON.Feature[] = []
    const parcelFeatures: GeoJSON.Feature[] = []
    const pinFeatures: GeoJSON.Feature[] = []

    for (const leg of state.legs) {
      const arc = this.geometry.arcs[leg.index]
      const dest = destinations[leg.index]
      if (!arc || !dest) continue

      if (leg.active && leg.t > 0) {
        const coords = sliceArc(arc, leg.t)
        if (coords.length >= 2) {
          arcFeatures.push({
            type: 'Feature',
            properties: {
              color: accent,
              width: 5,
              opacity: 0.96,
              glow: rgba(accent, 1),
              glowWidth: 14,
              glowOpacity: 0.28,
            },
            geometry: { type: 'LineString', coordinates: coords },
          })

          if (leg.parcel > 0.01) {
            parcelFeatures.push({
              type: 'Feature',
              properties: {
                r: lerp(4, 8, leg.parcel),
                opacity: leg.parcel,
                color: accent,
              },
              geometry: { type: 'Point', coordinates: coords[coords.length - 1] },
            })
          }
        }
      }

      if (leg.pin > 0.001) {
        pinFeatures.push({
          type: 'Feature',
          properties: {
            r: lerp(2, 11, leg.pin),
            halo: lerp(2, 26, leg.pin),
            haloOpacity: 0.18 * clamp01(leg.pin),
            opacity: clamp01(leg.pin * 1.4),
            stroke: 3,
            color: accent,
          },
          geometry: { type: 'Point', coordinates: [dest.lng, dest.lat] },
        })
      }
    }

    const hubFeature: GeoJSON.Feature = {
      type: 'Feature',
      properties: {
        outer: lerp(4, 20, state.hub.drop),
        inner: lerp(2, 12, state.hub.drop),
        opacity: clamp01(state.hub.drop * 1.5),
        color: shade(accent, -0.15),
      },
      geometry: { type: 'Point', coordinates: [origin.lng, origin.lat] },
    }

    const pulseFeature: GeoJSON.Feature = {
      type: 'Feature',
      properties: {
        r: lerp(18, 78, state.hub.pulse),
        w: lerp(5, 1, state.hub.pulse),
        opacity: state.hub.pulse === 0 ? 0 : (1 - state.hub.pulse) * 0.55 * state.hub.drop,
        color: accent,
      },
      geometry: { type: 'Point', coordinates: [origin.lng, origin.lat] },
    }

    this.setData(SRC_ARCS, arcFeatures)
    this.setData(SRC_PARCELS, parcelFeatures)
    this.setData(SRC_PINS, pinFeatures)
    this.setData(SRC_HUB, [hubFeature])
    this.setData(SRC_PULSE, [pulseFeature])

    return state
  }

  /**
   * Push new features into a source, skipping the update when nothing
   * changed. Each setData costs a round trip to the tiling worker, and the
   * export waits for the map to go idle on every frame — during the intro and
   * the final hold most of these sources are static.
   */
  private setData(id: string, features: GeoJSON.Feature[]): void {
    const source = this.map.getSource(id)
    if (!source || !('setData' in source)) return

    const serialised = JSON.stringify(features)
    if (this.lastSourceData.get(id) === serialised) return
    this.lastSourceData.set(id, serialised)

    ;(source as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features,
    } as never)
  }

  /** Draw the overlay canvas for `state`, projecting labels through the map. */
  drawOverlayFor(state: FrameState): void {
    const { origin, destinations, settings } = this.scene

    const hubPoint = this.map.project([origin.lng, origin.lat])
    const hubLabel: ProjectedLabel | null =
      state.hub.label > 0.01
        ? {
            x: hubPoint.x,
            y: hubPoint.y,
            text: origin.name,
            sub: origin.subLabel || 'Dispatch hub',
            opacity: state.hub.label,
            drop: state.hub.label,
          }
        : null

    const destinationLabels: ProjectedLabel[] = []
    for (const leg of state.legs) {
      const dest = destinations[leg.index]
      if (!dest || leg.label <= 0.01) continue
      const p = this.map.project([dest.lng, dest.lat])
      destinationLabels.push({
        x: p.x,
        y: p.y,
        text: dest.name,
        sub: dest.subLabel,
        opacity: leg.label,
        drop: leg.label,
      })
    }

    this.lastLabelLayout = drawOverlays(this.overlayCtx, {
      width: this.width,
      height: this.height,
      settings,
      state,
      hubLabel,
      destinationLabels,
      destinationCount: destinations.length,
      totalKm: this.geometry.totalKm,
      attribution: this.getAttribution(),
    })
  }

  /**
   * Flatten the attribution declared by the style's sources into plain text.
   * MapLibre renders its own attribution control as DOM, which the WebGL
   * canvas capture cannot see, so the credit has to be drawn onto the overlay
   * to make it into the exported video.
   */
  getAttribution(): string {
    const style = this.map.getStyle()
    if (!style) return ''

    const parts = new Set<string>()
    for (const source of Object.values(style.sources ?? {})) {
      const attribution = (source as { attribution?: string }).attribution
      if (!attribution) continue
      // Style attribution is HTML; the canvas needs plain text.
      const text = decodeEntities(attribution.replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
      if (text) parts.add(text)
    }

    if (parts.size === 0) {
      // The bundled offline style carries no third-party data.
      return this.scene.settings.mapStyle === 'offline' ? '' : '© OpenStreetMap contributors'
    }
    return [...parts].join(' · ')
  }

  /** Chip rectangles from the most recent frame. Used by the render tests. */
  getLabelLayout(): PlacedLabel[] {
    return this.lastLabelLayout
  }

  /**
   * Put the whole stage at `frame`: sources, camera, overlay. Does not wait
   * for the map to finish painting — callers that need pixels use
   * {@link settle} afterwards.
   */
  renderFrame(frame: number): FrameState {
    const state = this.updateSources(frame)
    this.map.jumpTo(this.cameraAt(frame))
    this.drawOverlayFor(state)
    this.lastFrame = frame
    return state
  }

  /**
   * Wait until the map has nothing left to draw. `redraw()` forces a
   * synchronous paint first so this still terminates when the tab is
   * throttled and requestAnimationFrame has stopped firing.
   */
  settle(timeoutMs = 2000): Promise<void> {
    if (this.destroyed) return Promise.resolve()
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.map.off('idle', finish)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      this.map.on('idle', finish)
      this.map.triggerRepaint()
      try {
        this.map.redraw()
      } catch {
        // redraw throws if the context is gone; the timeout covers us.
      }
      if (this.map.loaded() && !this.map.isMoving()) finish()
    })
  }

  /** Composite map + overlay into `ctx` at output resolution. */
  composite(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.drawImage(this.map.getCanvas(), 0, 0, this.width, this.height)
    ctx.drawImage(this.overlay, 0, 0, this.width, this.height)
  }

  destroy(): void {
    this.destroyed = true
    this.map.remove()
    this.root.remove()
  }
}

const HTML_ENTITIES: Record<string, string> = {
  '&copy;': '\u00a9',
  '&amp;': '&',
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#169;': '\u00a9',
}

function decodeEntities(input: string): string {
  return input.replace(/&(?:copy|amp|nbsp|lt|gt|quot|#39|#169);/g, (m) => HTML_ENTITIES[m] ?? m)
}

function buildGeometry(scene: Scene): Geometry {
  const arcs = scene.destinations.map((dest) => buildArc(scene.origin, dest))
  return {
    arcs,
    totalKm: arcs.reduce((sum, a) => sum + a.chordKm, 0),
  }
}

export type { StyleSpecification }
