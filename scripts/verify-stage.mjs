/**
 * Step 1 check: the stage boots, MapLibre paints, and the camera is fitted
 * over the hub plus its destinations.
 */
import { resolve } from 'node:path'
import { assert, ensureOutDir, launchBrowser, newPage, ok, startServer } from './harness.mjs'

const outDir = ensureOutDir()
const server = await startServer()
const browser = await launchBrowser()

try {
  const page = await newPage(browser)
  await page.goto(`${server.url}/?style=offline`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="ready-flag"]')?.textContent === 'stage-ready',
    undefined,
    { timeout: 90000 },
  )
  ok('stage reported ready')

  // Let the basemap settle before we look at pixels.
  await page.evaluate(async () => {
    await window.__stage.settle(4000)
  })

  const info = await page.evaluate(() => {
    const stage = window.__stage
    const canvas = stage.map.getCanvas()
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')

    // Sample the WebGL backbuffer directly: proof that preserveDrawingBuffer
    // is doing its job and the map really rendered something.
    const w = canvas.width
    const h = canvas.height
    const pixels = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const unique = new Set()
    let nonTransparent = 0
    let sampled = 0
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4
        sampled++
        if (pixels[i + 3] > 0) nonTransparent++
        unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
      }
    }

    const bounds = stage.map.getBounds()
    const scene = stage.getScene()
    const places = [scene.origin, ...scene.destinations]

    return {
      canvasWidth: w,
      canvasHeight: h,
      uniqueColors: unique.size,
      nonTransparent,
      sampled,
      displayedWidth: canvas.getBoundingClientRect().width,
      center: stage.map.getCenter(),
      zoom: stage.map.getZoom(),
      bounds: { w: bounds.getWest(), s: bounds.getSouth(), e: bounds.getEast(), n: bounds.getNorth() },
      places: places.map((p) => ({ name: p.name, lng: p.lng, lat: p.lat })),
      totalFrames: stage.getTimeline().totalFrames,
      previewScale: Number(
        (stage.root.style.transform.match(/scale\(([\d.]+)\)/) ?? [0, '0'])[1],
      ),
    }
  })

  console.log('  stage:', JSON.stringify({ ...info, places: `${info.places.length} places` }))

  assert(info.canvasWidth === 1080 && info.canvasHeight === 1920,
    'map canvas backing store is exactly 1080x1920',
    `got ${info.canvasWidth}x${info.canvasHeight}`)

  assert(info.uniqueColors > 1, 'map canvas painted basemap detail, not a flat fill',
    `only ${info.uniqueColors} unique colours`)

  assert(Math.abs(info.displayedWidth - 1080 * info.previewScale) < 2,
    'preview is the output canvas scaled down by CSS transform',
    `displayed ${info.displayedWidth}px at scale ${info.previewScale}`)

  assert(info.nonTransparent === info.sampled, 'every sampled pixel is opaque',
    `${info.nonTransparent}/${info.sampled}`)

  const inside = info.places.every(
    (p) =>
      p.lng > info.bounds.w && p.lng < info.bounds.e && p.lat > info.bounds.s && p.lat < info.bounds.n,
  )
  assert(inside, 'fitBounds camera contains hub and all destinations',
    JSON.stringify(info.bounds))

  // Margin check: the fit should not be so loose that the points crowd the middle.
  const spanLng = info.bounds.e - info.bounds.w
  const placeSpanLng =
    Math.max(...info.places.map((p) => p.lng)) - Math.min(...info.places.map((p) => p.lng))
  assert(spanLng < placeSpanLng * 6, 'camera is not absurdly zoomed out',
    `view span ${spanLng.toFixed(2)}° vs places ${placeSpanLng.toFixed(2)}°`)

  await page.screenshot({ path: resolve(outDir, '01-stage.png') })
  ok(`screenshot written to .verify/01-stage.png`)
} finally {
  await browser.close()
  await server.stop()
}
