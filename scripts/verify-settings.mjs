/**
 * Step 6 check: aspect ratios, basemap swapping, arc colour and pacing.
 *
 * tiles.openfreemap.org is blocked by this sandbox's egress policy, so the
 * style URL is intercepted and answered with a minimal but valid MapLibre
 * style. That still exercises the real path — the app fetches the URL it
 * would fetch in production, MapLibre parses it, and our layers are rebuilt
 * on top of the new style.
 */
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { assert, ensureOutDir, launchBrowser, newPage, ok, startServer } from './harness.mjs'

const MOCK_BACKGROUND = '#f4e7d3'

const outDir = ensureOutDir()
const server = await startServer()
const browser = await launchBrowser()

/**
 * Set a controlled input's value the way a user would. React installs a value
 * tracker on the DOM node, so a plain `el.value = x` assignment is swallowed —
 * the native setter has to be called before the event is dispatched.
 */
async function setInput(page, testId, value) {
  await page.locator(`[data-testid="${testId}"]`).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function shoot(page, name) {
  const dataUrl = await page.evaluate(async () => {
    const stage = window.__stage
    await stage.settle(4000)
    const out = document.createElement('canvas')
    out.width = stage.width
    out.height = stage.height
    stage.composite(out.getContext('2d'))
    return out.toDataURL('image/png')
  })
  writeFileSync(resolve(outDir, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
}

try {
  const page = await newPage(browser, { viewport: { width: 1500, height: 1000 } })

  const styleRequests = []
  await page.route('**://tiles.openfreemap.org/**', async (route) => {
    styleRequests.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        name: 'mock positron',
        sources: {
          // Carries HTML attribution, the way the real OpenFreeMap styles do.
          mock: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            attribution:
              '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; ' +
              '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': MOCK_BACKGROUND } }],
      }),
    })
  })

  // No ?style override here: the app requests the real OpenFreeMap positron
  // URL and the route above answers it, so the basemap dropdown stays live.
  await page.goto(server.url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })
  ok('editor ready')

  assert(styleRequests.some((u) => u.includes('/styles/liberty')),
    'the default basemap fetches the OpenFreeMap liberty style URL',
    JSON.stringify(styleRequests))
  assert(styleRequests.every((u) => !u.includes('access_token') && !u.includes('api_key')),
    'no API key or token is ever sent', JSON.stringify(styleRequests))

  const readStage = () =>
    page.evaluate(() => {
      const stage = window.__stage
      const canvas = stage.map.getCanvas()
      const places = [stage.getScene().origin, ...stage.getScene().destinations]
      const bounds = stage.map.getBounds()
      return {
        stage: { w: stage.width, h: stage.height },
        mapCanvas: { w: canvas.width, h: canvas.height },
        overlay: { w: stage.overlay.width, h: stage.overlay.height },
        zoom: stage.map.getZoom(),
        allInside: places.every(
          (p) =>
            p.lng > bounds.getWest() &&
            p.lng < bounds.getEast() &&
            p.lat > bounds.getSouth() &&
            p.lat < bounds.getNorth(),
        ),
        chips: stage.getLabelLayout().length,
        outOfFrameChips: stage
          .getLabelLayout()
          .filter((c) => c.x < 0 || c.y < 0 || c.x + c.w > stage.width || c.y + c.h > stage.height)
          .length,
      }
    })

  // --- aspect ratios --------------------------------------------------------
  const expected = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] }

  for (const [aspect, [w, h]] of Object.entries(expected)) {
    await page.click(`[data-testid="aspect-${aspect}"]`)
    await page.waitForFunction(
      ([width, height]) => window.__stage.width === width && window.__stage.height === height,
      [w, h],
      { timeout: 15000 },
    )
    // Drive to the last frame so every chip and the counter are on screen.
    await page.evaluate(() => {
      const stage = window.__stage
      stage.renderFrame(stage.getTimeline().totalFrames - 1)
    })
    const info = await readStage()
    console.log(`  ${aspect}:`, JSON.stringify(info))

    assert(info.stage.w === w && info.stage.h === h, `${aspect}: stage resized to ${w}x${h}`,
      `${info.stage.w}x${info.stage.h}`)
    assert(info.mapCanvas.w === w && info.mapCanvas.h === h,
      `${aspect}: map canvas backing store is ${w}x${h}`,
      `${info.mapCanvas.w}x${info.mapCanvas.h}`)
    assert(info.overlay.w === w && info.overlay.h === h,
      `${aspect}: overlay canvas matches`, `${info.overlay.w}x${info.overlay.h}`)
    assert(info.allInside, `${aspect}: camera refit keeps every place in frame`)
    assert(info.chips === 6, `${aspect}: all 6 chips are laid out`, `${info.chips}`)
    assert(info.outOfFrameChips === 0, `${aspect}: no chip falls outside the frame`,
      `${info.outOfFrameChips} outside`)

    await shoot(page, `06-aspect-${aspect.replace(':', 'x')}`)
  }

  // Back to portrait for the remaining checks.
  await page.click('[data-testid="aspect-9:16"]')
  await page.waitForFunction(() => window.__stage.height === 1920, undefined, { timeout: 15000 })

  // --- arc colour -----------------------------------------------------------
  await page.evaluate(() => {
    const stage = window.__stage
    stage.renderFrame(stage.getTimeline().totalFrames - 1)
  })
  const colourBefore = await page.evaluate(() => {
    const src = window.__stage.map.getStyle().sources['pm-arcs'].data
    return src.features[0]?.properties.color
  })

  await setInput(page, 'setting-color', '#38bdf8')
  await page.waitForFunction(
    () => {
      const stage = window.__stage
      stage.renderFrame(stage.getTimeline().totalFrames - 1)
      const src = stage.map.getStyle().sources['pm-arcs'].data
      return src.features[0]?.properties.color === '#38bdf8'
    },
    undefined,
    { timeout: 15000 },
  )
  ok(`arc colour propagates to the map layers (${colourBefore} -> #38bdf8)`)
  await shoot(page, '06-colour-green')

  // --- pacing ---------------------------------------------------------------
  // Compare the reveal span rather than the whole clip. The fixed hub intro
  // and final hold do not scale with this setting, so on a short list they
  // dilute the total badly enough to make a whole-clip ratio meaningless.
  const revealSpan = () =>
    page.evaluate(() => {
      const t = window.__stage.getTimeline()
      return { span: t.outroStart - t.legs[0].startFrame, total: t.totalFrames }
    })

  const paceBefore = await revealSpan()
  await setInput(page, 'setting-seconds', '1.2')
  await page.waitForFunction(
    (before) => window.__stage.getTimeline().totalFrames > before,
    paceBefore.total,
    { timeout: 15000 },
  )
  const paceAfter = await revealSpan()

  const ratio = paceAfter.span / paceBefore.span
  assert(ratio > 1.8 && ratio < 2.2,
    'doubling seconds-per-destination doubles the destination reveal span',
    `${paceBefore.span} -> ${paceAfter.span} frames (${ratio.toFixed(2)}x)`)
  assert(paceAfter.total > paceBefore.total,
    'and the clip as a whole gets longer',
    `${paceBefore.total} -> ${paceAfter.total} frames`)

  // --- slow zoom-out --------------------------------------------------------
  // Measure what the map actually ends up doing, not just what cameraAt()
  // returns. An earlier version of this check only compared cameraAt values,
  // which happily passed while the on-screen drift was far too small to see.
  const zoomToggle = page.locator('[data-testid="setting-zoomout"]')
  if (!(await zoomToggle.isChecked())) await zoomToggle.click()
  await page.waitForFunction(() => window.__stage.getScene().settings.slowZoomOut === true,
    undefined, { timeout: 10000 })

  const drift = await page.evaluate(() => {
    const stage = window.__stage
    const total = stage.getTimeline().totalFrames
    const sample = (f) => {
      stage.renderFrame(f)
      const b = stage.map.getBounds()
      return { applied: stage.map.getZoom(), span: b.getEast() - b.getWest() }
    }
    const first = sample(0)
    const last = sample(total - 1)
    return { first, last, width: stage.width }
  })

  const zoomDrop = drift.first.applied - drift.last.applied
  assert(Math.abs(zoomDrop - Math.log2(1.15)) < 1e-6,
    'the applied map zoom widens by 15% of scale across the clip',
    `zoom fell by ${zoomDrop}, expected ${Math.log2(1.15)}`)

  // Perceptibility floor: at 5% each edge moved 27px over the whole clip,
  // which read as the toggle doing nothing. Keep it comfortably above that.
  const edgeShiftPx = ((drift.last.span / drift.first.span) - 1) * drift.width / 2
  assert(edgeShiftPx > 50,
    'the drift is large enough to actually see',
    `each edge moves only ${edgeShiftPx.toFixed(1)}px across the clip`)

  assert(drift.last.span > drift.first.span,
    'the view widens rather than tightening, so nothing gets clipped',
    `${drift.first.span} -> ${drift.last.span}`)

  await zoomToggle.click()
  await page.waitForFunction(() => window.__stage.getScene().settings.slowZoomOut === false,
    undefined, { timeout: 10000 })
  const staticCam = await page.evaluate(() => {
    const stage = window.__stage
    const total = stage.getTimeline().totalFrames
    stage.renderFrame(0)
    const first = stage.map.getZoom()
    stage.renderFrame(total - 1)
    return { first, last: stage.map.getZoom() }
  })
  assert(staticCam.first === staticCam.last,
    'with the toggle off the applied camera is completely static',
    `${staticCam.first} vs ${staticCam.last}`)

  // --- basemap swap ---------------------------------------------------------
  // liberty -> offline (a bundled style object) ...
  await page.selectOption('[data-testid="setting-style"]', 'offline')
  await page.waitForFunction(
    () => window.__stage.map.getStyle()?.name === 'ParcelMap offline grid',
    undefined,
    { timeout: 30000 },
  )
  ok('swapping to the bundled offline basemap works')

  // ... and back out to a fetched style URL.
  await page.selectOption('[data-testid="setting-style"]', 'positron')
  await page.waitForFunction(
    () => window.__stage.map.getStyle()?.name === 'mock positron',
    undefined,
    { timeout: 30000 },
  )
  assert(styleRequests.some((u) => u.includes('/styles/positron')),
    'selecting Positron fetches its OpenFreeMap style URL',
    JSON.stringify(styleRequests))

  // The swap finishes asynchronously and restores the frame the user was on,
  // so poll until re-rendering the last frame sticks rather than racing it.
  await page.waitForFunction(
    () => {
      const stage = window.__stage
      stage.renderFrame(stage.getTimeline().totalFrames - 1)
      const arcs = stage.map.getStyle().sources['pm-arcs']?.data
      return arcs?.features?.length === 5
    },
    undefined,
    { timeout: 30000 },
  )

  const afterSwap = await page.evaluate(async () => {
    const stage = window.__stage
    stage.renderFrame(stage.getTimeline().totalFrames - 1)
    await stage.settle(5000)
    const style = stage.map.getStyle()
    const canvas = stage.map.getCanvas()
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    const px = new Uint8Array(4)
    gl.readPixels(20, 20, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const arcs = style.sources['pm-arcs']?.data
    return {
      styleName: style.name,
      hasOurLayers: ['pm-arc-line', 'pm-pin', 'pm-hub-inner'].every((id) =>
        style.layers.some((l) => l.id === id),
      ),
      arcFeatures: arcs?.features?.length ?? 0,
      cornerPixel: [px[0], px[1], px[2]],
      usedFallback: stage.usedFallbackStyle,
    }
  })
  console.log('  after basemap swap:', JSON.stringify(afterSwap))

  assert(afterSwap.hasOurLayers,
    'the arc, pin and hub layers are rebuilt on top of the new basemap')
  assert(afterSwap.arcFeatures === 5,
    'all 5 arcs are repopulated after the style swap', `${afterSwap.arcFeatures} arcs`)
  assert(!afterSwap.usedFallback, 'a reachable style is not replaced by the offline fallback')

  const [r, g, b] = afterSwap.cornerPixel
  const expectedRgb = [
    parseInt(MOCK_BACKGROUND.slice(1, 3), 16),
    parseInt(MOCK_BACKGROUND.slice(3, 5), 16),
    parseInt(MOCK_BACKGROUND.slice(5, 7), 16),
  ]
  assert(
    Math.abs(r - expectedRgb[0]) <= 2 &&
      Math.abs(g - expectedRgb[1]) <= 2 &&
      Math.abs(b - expectedRgb[2]) <= 2,
    'the newly fetched basemap is what actually gets painted',
    `pixel ${afterSwap.cornerPixel} vs style background ${expectedRgb}`,
  )

  await shoot(page, '06-style-swapped')
  ok('basemap swap keeps the animation intact')

  // --- attribution ----------------------------------------------------------
  // MapLibre's own attribution control is DOM and never reaches the WebGL
  // canvas, so the credit has to be painted onto the overlay to survive export.
  const credit = await page.evaluate(() => window.__stage.getAttribution())
  assert(credit === 'OpenFreeMap \u00a9 OpenStreetMap contributors',
    'style attribution is flattened to plain text for the overlay',
    JSON.stringify(credit))

  const attributionInk = await page.evaluate(() => {
    const stage = window.__stage
    stage.renderFrame(stage.getTimeline().totalFrames - 1)
    // Bottom-right strip of the overlay canvas, where the credit is drawn.
    const ctx = stage.overlay.getContext('2d')
    const w = 460
    const h = 40
    const { data } = ctx.getImageData(stage.width - w, stage.height - 46, w, h)
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 16) painted++
    return painted
  })
  assert(attributionInk > 2000,
    'the credit is actually painted into the overlay canvas',
    `${attributionInk} opaque pixels in the attribution strip`)

  await page.selectOption('[data-testid="setting-style"]', 'offline')
  await page.waitForFunction(
    () => window.__stage.map.getStyle()?.name === 'ParcelMap offline grid',
    undefined,
    { timeout: 30000 },
  )
  const offlineCredit = await page.evaluate(() => window.__stage.getAttribution())
  assert(offlineCredit === '',
    'the bundled offline basemap claims no third-party credit',
    JSON.stringify(offlineCredit))
} finally {
  await browser.close()
  await server.stop()
}
