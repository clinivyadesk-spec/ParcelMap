/**
 * Step 2/3 check: driving a frame number progressively reveals arcs on the
 * map, drops pins, and paints the overlay canvas.
 */
import { resolve } from 'node:path'
import { assert, ensureOutDir, launchBrowser, newPage, ok, startServer } from './harness.mjs'

const outDir = ensureOutDir()
const server = await startServer()
const browser = await launchBrowser()

try {
  const page = await newPage(browser, { viewport: { width: 900, height: 1000 } })
  await page.goto(`${server.url}/?style=offline`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })
  ok('stage ready')

  const probe = await page.evaluate(async () => {
    const stage = window.__stage
    const t = stage.getTimeline()
    const map = stage.map

    const sourceCounts = () => {
      const read = (id) => {
        const d = map.getStyle().sources[id].data
        return typeof d === 'object' ? d.features : []
      }
      const arcs = read('pm-arcs')
      return {
        arcs: arcs.length,
        arcVertexTotal: arcs.reduce((n, f) => n + f.geometry.coordinates.length, 0),
        firstArcVertices: arcs[0]?.geometry.coordinates.length ?? 0,
        parcels: read('pm-parcels').length,
        pins: read('pm-pins').length,
        hubRadius: read('pm-hub')[0]?.properties.outer ?? 0,
      }
    }

    // Overlay canvas ink coverage, to prove overlays composite on top.
    const overlayInk = () => {
      const c = stage.overlay
      const ctx = c.getContext('2d')
      const { data } = ctx.getImageData(0, 0, c.width, c.height)
      let painted = 0
      let sampled = 0
      for (let i = 3; i < data.length; i += 4 * 37) {
        sampled++
        if (data[i] > 8) painted++
      }
      return { painted, sampled }
    }

    const samples = {}
    const frames = {
      f0: 0,
      hubMid: 22,
      beforeFirstArc: t.legs[0].startFrame - 1,
      firstArcQuarter: t.legs[0].startFrame + Math.round(t.legs[0].arcFrames * 0.25),
      firstArcHalf: t.legs[0].startFrame + Math.round(t.legs[0].arcFrames * 0.5),
      firstArrival: t.legs[0].arriveFrame,
      afterFirstPin: t.legs[0].arriveFrame + 12,
      midway: Math.round(t.totalFrames / 2),
      outroStart: t.outroStart,
      lastFrame: t.totalFrames - 1,
    }

    for (const [label, frame] of Object.entries(frames)) {
      stage.renderFrame(frame)
      samples[label] = { frame, ...sourceCounts(), overlay: overlayInk() }
    }

    return { frames, samples, totalLegs: t.legs.length, totalFrames: t.totalFrames }
  })

  const s = probe.samples
  console.log('  frame samples:')
  for (const [k, v] of Object.entries(s)) {
    console.log(
      `    ${k.padEnd(17)} f=${String(v.frame).padStart(3)} arcs=${v.arcs} verts=${String(v.arcVertexTotal).padStart(4)} parcels=${v.parcels} pins=${String(v.pins).padStart(2)} overlayInk=${((v.overlay.painted / v.overlay.sampled) * 100).toFixed(1)}%`,
    )
  }

  assert(s.f0.arcs === 0 && s.beforeFirstArc.arcs === 0,
    'no arcs before the hub intro finishes')

  assert(s.f0.hubRadius < s.hubMid.hubRadius,
    'hub marker grows during the drop-in',
    `${s.f0.hubRadius} -> ${s.hubMid.hubRadius}`)

  assert(s.firstArcQuarter.arcs === 1, 'first arc appears on schedule',
    `arcs=${s.firstArcQuarter.arcs}`)

  assert(
    s.firstArcQuarter.firstArcVertices < s.firstArcHalf.firstArcVertices &&
      s.firstArcHalf.firstArcVertices < s.firstArrival.firstArcVertices,
    'the first arc gains vertices as it draws (progressive reveal)',
    `${s.firstArcQuarter.firstArcVertices} -> ${s.firstArcHalf.firstArcVertices} -> ${s.firstArrival.firstArcVertices}`,
  )

  assert(s.firstArrival.firstArcVertices === 64,
    'a fully drawn arc is exactly the 64 sampled points',
    `got ${s.firstArrival.firstArcVertices}`)

  assert(s.firstArcHalf.parcels === 1, 'a parcel dot rides the arc while it draws')

  assert(s.firstArrival.pins === 0 && s.afterFirstPin.pins === 1,
    'the pin drops only after arrival',
    `arrival=${s.firstArrival.pins} after=${s.afterFirstPin.pins}`)

  assert(s.lastFrame.arcs === probe.totalLegs && s.lastFrame.pins === probe.totalLegs,
    'every arc and pin is present on the final frame',
    `arcs=${s.lastFrame.arcs} pins=${s.lastFrame.pins} legs=${probe.totalLegs}`)

  assert(s.lastFrame.parcels === 0, 'parcel dots are gone once everything has landed')

  assert(s.f0.overlay.painted > 0, 'overlay canvas paints on frame 0 (title/scrims)')

  assert(s.lastFrame.overlay.painted > s.f0.overlay.painted,
    'overlay gains ink by the final frame (labels + counter)',
    `${s.f0.overlay.painted} -> ${s.lastFrame.overlay.painted}`)

  // Label chips must never sit on top of each other, at any frame.
  const collisions = await page.evaluate(() => {
    const stage = window.__stage
    const total = stage.getTimeline().totalFrames
    const bad = []
    for (let f = 0; f < total; f += 3) {
      stage.renderFrame(f)
      const chips = stage.getLabelLayout()
      for (let i = 0; i < chips.length; i++) {
        for (let j = i + 1; j < chips.length; j++) {
          const a = chips[i]
          const b = chips[j]
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          if (ox > 1 && oy > 1) {
            bad.push({ frame: f, a: a.text, b: b.text, area: Math.round(ox * oy) })
          }
        }
      }
    }
    return { bad: bad.slice(0, 6), count: bad.length, checked: Math.ceil(total / 3) }
  })
  assert(collisions.count === 0,
    `no label chips overlap across ${collisions.checked} sampled frames`,
    JSON.stringify(collisions.bad))

  // Visual contact sheet across the clip.
  const shots = ['hubMid', 'firstArcHalf', 'afterFirstPin', 'midway', 'lastFrame']
  for (const label of shots) {
    await page.evaluate(async (f) => {
      window.__stage.renderFrame(f)
      await window.__stage.settle(4000)
    }, probe.frames[label])
    const dataUrl = await page.evaluate(() => {
      const stage = window.__stage
      const out = document.createElement('canvas')
      out.width = stage.width
      out.height = stage.height
      stage.composite(out.getContext('2d'))
      return out.toDataURL('image/png')
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(resolve(outDir, `02-${label}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
  }
  ok(`wrote ${shots.length} composited frames to .verify/02-*.png`)

  // The slider must drive the same render path.
  await page.fill('[data-testid="frame-slider"]', String(probe.frames.midway)).catch(() => {})
  await page.evaluate((f) => {
    const el = document.querySelector('[data-testid="frame-slider"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, String(f))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, probe.frames.midway)
  const readout = await page.textContent('[data-testid="frame-readout"]')
  assert(readout.startsWith(`${probe.frames.midway}/`),
    'the frame slider drives the stage', `readout="${readout}"`)

  // The shipped sample is a small fan, so push a deliberately crowded scene
  // through the same layout code to keep the collision invariant under load.
  const stress = await page.evaluate(() => {
    const stage = window.__stage
    const scene = stage.getScene()
    stage.setScene({
      ...scene,
      destinations: [
        ['Guntur', 80.4365, 16.3067], ['Tenali', 80.64, 16.243],
        ['Eluru', 81.0952, 16.7107], ['Gudivada', 80.993, 16.4333],
        ['Machilipatnam', 81.1389, 16.1875], ['Nuzvid', 80.8461, 16.7877],
        ['Bhimavaram', 81.5212, 16.5449], ['Narasaraopet', 80.049, 16.235],
        ['Ongole', 80.0499, 15.5057], ['Chirala', 80.352, 15.8237],
        ['Rajahmundry', 81.804, 17.0005], ['Kakinada', 82.2475, 16.9891],
        ['Tanuku', 81.68, 16.75], ['Vinukonda', 79.74, 16.05],
        ['Piduguralla', 79.88, 16.48], ['Jaggayyapeta', 80.1, 16.89],
      ].map(([name, lng, lat], i) => ({
        id: `stress_${i}`, name, lng, lat, subLabel: `${i + 3} units`,
      })),
    })

    const total = stage.getTimeline().totalFrames
    let worst = null
    let collisions = 0
    for (let f = 0; f < total; f += 3) {
      stage.renderFrame(f)
      const chips = stage.getLabelLayout()
      for (let i = 0; i < chips.length; i++) {
        for (let j = i + 1; j < chips.length; j++) {
          const a = chips[i], b = chips[j]
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          if (ox > 1 && oy > 1) {
            collisions++
            if (!worst) worst = { frame: f, a: a.text, b: b.text }
          }
        }
      }
    }
    stage.renderFrame(total - 1)
    return { chips: stage.getLabelLayout().length, collisions, worst, total }
  })
  assert(stress.collisions === 0,
    `no chip collisions with a crowded ${stress.chips}-chip fan`,
    JSON.stringify(stress.worst))
} finally {
  await browser.close()
  await server.stop()
}
