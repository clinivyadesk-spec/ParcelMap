/**
 * Layout checks at phone and desktop sizes, plus a first-visit check that the
 * bundled sample really is the one that ships.
 */
import { resolve } from 'node:path'
import { assert, ensureOutDir, launchBrowser, newPage, ok, startServer } from './harness.mjs'

const PHONE = { width: 390, height: 844 } // iPhone 14-ish
const TABLET = { width: 820, height: 1180 }
const DESKTOP = { width: 1500, height: 1000 }

const outDir = ensureOutDir()
const server = await startServer()
const browser = await launchBrowser()

async function boot(viewport) {
  const page = await newPage(browser, { viewport })
  await page.goto(`${server.url}/?style=offline`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })
  // The debounced autosave populates the project picker ~700ms in, which
  // changes the widest <option> and therefore the layout. Measuring before
  // that lands hides real overflow, so wait for it.
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('parcelmap.projects.v1') ?? '[]').length > 0,
    undefined,
    { timeout: 15000 },
  )
  return page
}

/**
 * Measure horizontal overflow once the layout has settled. The stage is
 * scaled to fit by a ResizeObserver, so sampling immediately after boot
 * catches a transient intermediate width rather than the real one.
 */
const overflow = async (page) => {
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  )
  return page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }))
}

try {
  // --- first visit ships the bundled sample ---------------------------------
  {
    const page = await boot(DESKTOP)
    const seeded = await page.evaluate(() => {
      const stage = window.__stage
      const scene = stage.getScene()
      return {
        origin: scene.origin.name,
        originSub: scene.origin.subLabel,
        title: scene.settings.title,
        subtitle: scene.settings.subtitle,
        logo: scene.settings.logoText,
        colour: scene.settings.arcColor,
        drift: scene.settings.slowZoomOut,
        destinations: scene.destinations.map((d) => d.name),
      }
    })
    console.log('  first visit:', JSON.stringify(seeded))

    assert(seeded.origin === "Dr Rakesh's Homoeopathy",
      'a fresh browser is seeded with the clinic as origin', seeded.origin)
    assert(seeded.originSub === 'Main branch', 'with its sub-label', seeded.originSub)
    assert(seeded.title === "Dr Rakesh's Homoeopathy", 'and the clinic title', seeded.title)
    assert(seeded.subtitle === 'A complete family clinic', 'and subtitle', seeded.subtitle)
    assert(seeded.logo === "Dr Rakesh's Homoeopathy", 'and wordmark', seeded.logo)
    assert(seeded.colour === '#22c55e', 'green arcs', seeded.colour)
    assert(seeded.drift === true, 'camera drift on', String(seeded.drift))
    assert(seeded.destinations.length === 5 && seeded.destinations[0] === 'Ongole',
      'and the five delivery towns', JSON.stringify(seeded.destinations))

    const build = await page.textContent('[data-testid="build-id"]')
    assert(/^build \S+/.test(build?.trim() ?? ''),
      'the running build is identified in the UI', build)
    console.log('  build stamp:', build?.trim())

    // A stale saved project must not be silently replaced, but "Load sample"
    // must always give the current bundled one.
    await page.evaluate(() => {
      localStorage.setItem(
        'parcelmap.projects.v1',
        JSON.stringify([
          {
            id: 'legacy',
            name: 'Vijayawada daily run',
            origin: { id: 'o', name: 'Vijayawada', lng: 80.648, lat: 16.5062, subLabel: 'Dispatch hub' },
            destinations: [{ id: 'd', name: 'Guntur', lng: 80.4365, lat: 16.3067 }],
            settings: { title: 'Daily Dispatch' },
            updatedAt: Date.now(),
          },
        ]),
      )
      localStorage.setItem('parcelmap.currentProject.v1', 'legacy')
    })
    await page.reload({ waitUntil: 'load' })
    await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })

    const restored = await page.evaluate(() => window.__stage.getScene().origin.name)
    assert(restored === 'Vijayawada',
      'an existing saved project is restored, not overwritten', restored)

    await page.click('[data-testid="load-sample"]')
    await page.waitForFunction(
      () => window.__stage.getScene().origin.name === "Dr Rakesh's Homoeopathy",
      undefined,
      { timeout: 15000 },
    )
    ok('"Load sample" replaces it with the current bundled sample')
    await page.close()
  }

  // --- phone ----------------------------------------------------------------
  {
    const page = await boot(PHONE)

    const layout = await page.evaluate(() => ({
      tabs: document.querySelectorAll('[role="tab"]').length,
      hasSidebar: document.querySelector('[data-testid="editor-panel"]') != null,
      previewVisible: document.querySelector('[data-testid="stage-holder"]') != null,
    }))
    assert(layout.tabs === 3, 'the phone layout shows three tabs', `${layout.tabs}`)
    assert(layout.previewVisible, 'the preview is mounted on a phone')

    const scroll = await overflow(page)
    console.log('  phone overflow:', JSON.stringify(scroll))
    assert(scroll.docScroll <= scroll.docClient + 1,
      'the page does not scroll sideways on a phone',
      `scrollWidth ${scroll.docScroll} vs clientWidth ${scroll.docClient}`)

    // The stage must be scaled to fit, not cropped.
    const fit = await page.evaluate(() => {
      const holder = document.querySelector('[data-testid="stage-holder"]').getBoundingClientRect()
      return { w: holder.width, h: holder.height, vw: window.innerWidth, vh: window.innerHeight }
    })
    console.log('  stage box:', JSON.stringify(fit))
    assert(fit.w > 40 && fit.w <= fit.vw,
      'the preview fits the phone width', `${fit.w} of ${fit.vw}`)
    assert(fit.h > 40 && fit.h <= fit.vh,
      'the preview fits the phone height', `${fit.h} of ${fit.vh}`)

    // Tabs actually switch content.
    assert(await page.isVisible('[data-testid="destination-search"]'),
      'the Places tab is showing by default')

    await page.click('[data-testid="tab-style"]')
    assert(await page.isVisible('[data-testid="setting-title"]'),
      'the Style tab reveals the video settings')
    assert(!(await page.isVisible('[data-testid="destination-search"]')),
      'and hides the Places panel')

    await page.click('[data-testid="tab-export"]')
    assert(await page.isVisible('[data-testid="render-button"]'),
      'the Export tab reveals the render button')

    await page.click('[data-testid="tab-places"]')
    assert(await page.isVisible('[data-testid="project-name"]'),
      'project controls are reachable on a phone')

    // The highlighted tab must always match the panel being shown.
    for (const [id, panel] of [
      ['places', 'destination-search'],
      ['style', 'setting-title'],
      ['export', 'render-button'],
    ]) {
      await page.click(`[data-testid="tab-${id}"]`)
      const agree = await page.evaluate(
        ([tabId, panelId]) => {
          const selected = [...document.querySelectorAll('[role="tab"]')]
            .filter((b) => b.getAttribute('aria-selected') === 'true')
            .map((b) => b.dataset.testid)
          return selected.length === 1 &&
            selected[0] === `tab-${tabId}` &&
            document.querySelector(`[data-testid="${panelId}"]`) != null
        },
        [id, panel],
      )
      assert(agree, `the ${id} tab highlights itself and shows its own panel`)
    }
    await page.click('[data-testid="tab-places"]')

    // Touch targets need to be big enough to hit.
    const smallTargets = await page.evaluate(() => {
      const tooSmall = []
      for (const el of document.querySelectorAll('button, [role="tab"], select')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.height < 28) tooSmall.push(`${el.dataset.testid ?? el.tagName}:${Math.round(r.height)}`)
      }
      return tooSmall
    })
    assert(smallTargets.length === 0,
      'interactive controls are tall enough to tap',
      JSON.stringify(smallTargets))

    // Disable animations: Tailwind's `transition` on the tab colours means a
    // screenshot taken right after a click catches the highlight mid-fade and
    // looks like the wrong tab is active.
    await page.screenshot({ path: resolve(outDir, '07-phone.png'), animations: 'disabled' })
    ok('phone screenshot written')
    await page.close()
  }

  // --- tablet ---------------------------------------------------------------
  {
    const page = await boot(TABLET)
    const scroll = await overflow(page)
    assert(scroll.docScroll <= scroll.docClient + 1,
      'no sideways scroll on a tablet',
      `${scroll.docScroll} vs ${scroll.docClient}`)
    assert(await page.isVisible('[data-testid="tab-places"]'),
      'the tablet also gets the stacked layout')
    await page.close()
  }

  // --- desktop keeps the three-column layout --------------------------------
  {
    const page = await boot(DESKTOP)
    const layout = await page.evaluate(() => ({
      tabs: document.querySelectorAll('[role="tab"]').length,
      sidebar: document.querySelector('[data-testid="editor-panel"]')?.getBoundingClientRect().width,
      settingsVisible: document.querySelector('[data-testid="setting-title"]') != null,
      exportVisible: document.querySelector('[data-testid="render-button"]') != null,
    }))
    console.log('  desktop layout:', JSON.stringify(layout))
    assert(layout.tabs === 0, 'no tab bar on desktop', `${layout.tabs} tabs`)
    assert(Math.round(layout.sidebar) === 380, 'the editor sidebar is present',
      `${layout.sidebar}px`)
    assert(layout.settingsVisible && layout.exportVisible,
      'settings and export are both visible at once on desktop')

    const scroll = await overflow(page)
    assert(scroll.docScroll <= scroll.docClient + 1, 'no sideways scroll on desktop')

    // Only one map may ever exist.
    const canvases = await page.evaluate(
      () => document.querySelectorAll('canvas.maplibregl-canvas').length,
    )
    assert(canvases === 1, 'exactly one MapLibre canvas is mounted', `${canvases}`)

    await page.screenshot({ path: resolve(outDir, '07-desktop.png'), animations: 'disabled' })
    ok('desktop screenshot written')
    await page.close()
  }
} finally {
  await browser.close()
  await server.stop()
}
