/**
 * Guard rails around the export.
 *
 * The encoder is configured once, for one frame size and one timeline, and
 * then renders against the live stage. Anything that mutates the scene
 * mid-render used to silently produce a corrupt file that still reported
 * success, so these cases matter more than they look.
 */
import { assert, launchBrowser, newPage, ok, startServer } from './harness.mjs'

const FRAMES = 40
const server = await startServer()
const browser = await launchBrowser()

const url = (extra = '') =>
  `${server.url}/?style=offline&codec=vp09.00.10.08&frames=${FRAMES}${extra}`

/** Start a render and wait until it is a few frames in. */
async function startRender(page, minFrame = 4) {
  await page.click('[data-testid="render-button"]')
  await page.waitForFunction(
    (n) => {
      const el = document.querySelector('[data-testid="export-frame-count"]')
      const m = /frame (\d+)\//.exec(el?.textContent ?? '')
      return m != null && Number(m[1]) >= n
    },
    minFrame,
    { timeout: 180000 },
  )
}

try {
  // --- 1. the editor is inert while rendering -------------------------------
  {
    const page = await newPage(browser, { viewport: { width: 1500, height: 1000 } })
    await page.goto(url(), { waitUntil: 'load' })
    await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })

    const before = await page.locator('[data-testid="aspect-16:9"]').isDisabled()
    assert(!before, 'aspect controls are usable before a render starts')

    await startRender(page)

    // `.disabled` only reflects the element's own attribute. A control inside
    // a disabled <fieldset> is effectively disabled but reports false, so
    // match on :disabled, which is what the browser actually enforces.
    const locked = await page.evaluate(() => {
      const off = (sel) => document.querySelector(sel)?.matches(':disabled')
      return {
        editor: off('[data-testid="editor-panel"]'),
        projects: off('[data-testid="project-controls"]'),
        aspect: off('[data-testid="aspect-16:9"]'),
        seconds: off('[data-testid="setting-seconds"]'),
        slider: off('[data-testid="frame-slider"]'),
        draggable: document.querySelector('[data-testid="destination-item"]')?.draggable,
      }
    })
    console.log('  locked during render:', JSON.stringify(locked))

    assert(locked.editor === true, 'the editor panel is disabled while rendering')
    assert(locked.projects === true, 'the project controls are disabled while rendering')
    assert(locked.aspect === true, 'aspect buttons are disabled while rendering')
    assert(locked.seconds === true, 'pacing is disabled while rendering')
    assert(locked.slider === true, 'the preview scrubber is disabled while rendering')
    assert(locked.draggable === false, 'destinations cannot be dragged while rendering')

    // Clicking through the disabled control must not move the stage.
    const size = await page.evaluate(() => ({ w: window.__stage.width, h: window.__stage.height }))
    await page.click('[data-testid="aspect-16:9"]', { force: true }).catch(() => {})
    const after = await page.evaluate(() => ({ w: window.__stage.width, h: window.__stage.height }))
    assert(after.w === size.w && after.h === size.h,
      'forcing a click on a locked control cannot resize the stage mid-render',
      `${size.w}x${size.h} -> ${after.w}x${after.h}`)

    const download = await page.waitForEvent('download', { timeout: 240000 })
    assert(download.suggestedFilename().endsWith('.mp4'),
      'the render still completes normally', download.suggestedFilename())

    // The download fires from inside the export call, before React has
    // committed the "no longer rendering" state, so wait rather than sample.
    const unlocked = await page
      .waitForFunction(
        () => document.querySelector('[data-testid="editor-panel"]')?.matches(':disabled') === false,
        undefined,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false)
    assert(unlocked, 'the editor is usable again once the render finishes')
    await page.close()
  }

  // --- 2. a scene change that slips past the lock fails loudly --------------
  {
    const page = await newPage(browser, { viewport: { width: 1500, height: 1000 } })
    await page.goto(url(), { waitUntil: 'load' })
    await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })
    await startRender(page)

    // Bypass the UI entirely, the way a future refactor might.
    await page.evaluate(() => {
      const stage = window.__stage
      const scene = stage.getScene()
      stage.setScene({ ...scene, settings: { ...scene.settings, aspect: '16:9' } })
    })

    const outcome = await Promise.race([
      page
        .waitForSelector('[data-testid="export-error"]', { timeout: 120000 })
        .then((el) => el.textContent())
        .then((text) => ({ kind: 'error', text })),
      page
        .waitForEvent('download', { timeout: 120000 })
        .then((d) => ({ kind: 'download', text: d.suggestedFilename() })),
    ])
    console.log('  outcome:', JSON.stringify(outcome))

    assert(outcome.kind === 'error',
      'a resize mid-render aborts instead of writing a corrupt file',
      `got a ${outcome.kind}: ${outcome.text}`)
    assert(/size changed/i.test(outcome.text ?? ''),
      'and says plainly what went wrong', outcome.text)
    assert(/nothing was saved/i.test(outcome.text ?? ''),
      'and tells the user nothing was saved', outcome.text)
    await page.close()
  }

  // --- 3. cancelling is not an error ----------------------------------------
  {
    const page = await newPage(browser, { viewport: { width: 1500, height: 1000 } })
    await page.goto(url(), { waitUntil: 'load' })
    await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })
    await startRender(page)

    let downloaded = false
    page.on('download', () => { downloaded = true })

    await page.click('[data-testid="cancel-render"]')
    await page.waitForFunction(
      () => document.querySelector('[data-testid="export-progress"]') == null,
      undefined,
      { timeout: 60000 },
    )

    const errorShown = await page.$('[data-testid="export-error"]')
    assert(!errorShown, 'cancelling does not raise an error banner')
    assert(!downloaded, 'cancelling does not download a partial file')

    const usable = await page.evaluate(() => ({
      editor: document.querySelector('[data-testid="editor-panel"]')?.matches(':disabled'),
      button: document.querySelector('[data-testid="render-button"]')?.matches(':disabled'),
    }))
    assert(usable.editor === false && usable.button === false,
      'the editor and render button are usable again after cancelling',
      JSON.stringify(usable))
    ok('cancel leaves the app in a clean state')
    await page.close()
  }
} finally {
  await browser.close()
  await server.stop()
}
