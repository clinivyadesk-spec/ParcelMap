/**
 * Step 5 check: the editor's geocoding, destination management and
 * localStorage persistence.
 *
 * nominatim.openstreetmap.org is blocked by this sandbox's egress policy, so
 * the request is intercepted at the network layer and answered with a
 * recorded Nominatim response. The app code under test is unchanged: it still
 * builds the real query URL, and the test asserts on that URL.
 */
import { resolve } from 'node:path'
import { assert, ensureOutDir, launchBrowser, newPage, ok, startServer } from './harness.mjs'

const NOMINATIM_FIXTURE = [
  {
    display_name: 'Guntur, Guntur district, Andhra Pradesh, 522001, India',
    name: 'Guntur',
    lat: '16.3066White',
    lon: '80.4365',
    address: { city: 'Guntur', state: 'Andhra Pradesh', country: 'India' },
  },
]
// Fix the deliberately malformed latitude above — it exists to prove the
// client filters out unparseable rows rather than producing NaN pins.
const VALID_ROW = {
  display_name: 'Guntur, Guntur district, Andhra Pradesh, 522001, India',
  name: 'Guntur',
  lat: '16.3067',
  lon: '80.4365',
  address: { city: 'Guntur', state: 'Andhra Pradesh', country: 'India' },
}

const outDir = ensureOutDir()
const server = await startServer()
const browser = await launchBrowser()

try {
  const page = await newPage(browser, { viewport: { width: 1500, height: 1000 } })

  const geocodeRequests = []
  await page.route('**://nominatim.openstreetmap.org/**', async (route) => {
    geocodeRequests.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([...NOMINATIM_FIXTURE, VALID_ROW]),
    })
  })

  await page.goto(`${server.url}/?style=offline`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })
  ok('editor booted with the sample project')

  const initialCount = await page.locator('[data-testid="destination-item"]').count()
  assert(initialCount === 5, 'sample project loads its 5 destinations', `got ${initialCount}`)

  // --- geocoding ------------------------------------------------------------
  await page.fill('[data-testid="destination-search"]', 'Guntur')
  await page.waitForFunction(() => document.querySelector('[data-testid="place-results"]') != null,
    undefined, { timeout: 15000 })

  const elapsedBeforeResults = geocodeRequests.length
  assert(elapsedBeforeResults === 1,
    'a single debounced request is sent while typing',
    `${elapsedBeforeResults} requests`)

  const url = new URL(geocodeRequests[0])
  assert(url.origin + url.pathname === 'https://nominatim.openstreetmap.org/search',
    'queries the Nominatim search endpoint', url.toString())
  assert(url.searchParams.get('format') === 'json', 'requests format=json')
  assert(url.searchParams.get('q') === 'Guntur', 'passes the query through')
  assert(url.searchParams.get('countrycodes') === 'in', 'restricts to countrycodes=in')

  const resultText = await page.textContent('[data-testid="place-results"]')
  assert(resultText.includes('Guntur'), 'the result list shows the geocoded place')

  const resultCount = await page.locator('[data-testid="place-results"] li').count()
  assert(resultCount === 1, 'rows with unparseable coordinates are discarded',
    `${resultCount} rows rendered from 2 returned`)

  await page.click('[data-testid="place-results"] li button')
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="destination-item"]').length === n,
    6,
    { timeout: 10000 },
  )
  ok('picking a result appends a destination')

  // --- geocode cache --------------------------------------------------------
  await page.fill('[data-testid="destination-search"]', 'Guntur')
  await page.waitForTimeout(1600)
  assert(geocodeRequests.length === 1,
    'a repeated query is served from the localStorage cache, with no new request',
    `${geocodeRequests.length} total requests`)
  await page.fill('[data-testid="destination-search"]', '')

  // --- raw lat,lng fallback -------------------------------------------------
  await page.fill('[data-testid="destination-search"]', '17.6868, 83.2185')
  await page.waitForSelector('[data-testid="accept-coords"]', { timeout: 10000 })
  await page.click('[data-testid="accept-coords"]')
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="destination-item"]').length === n,
    7,
    { timeout: 10000 },
  )
  assert(geocodeRequests.length === 1,
    'pasting coordinates does not hit the geocoder at all')

  const lastCoords = await page
    .locator('[data-testid="destination-item"]')
    .last()
    .textContent()
  assert(lastCoords.includes('17.6868') && lastCoords.includes('83.2185'),
    'pasted coordinates land on the destination', lastCoords.replace(/\s+/g, ' '))

  // --- rename + sub-label ---------------------------------------------------
  const firstName = page.locator('[data-testid="destination-name"]').first()
  await firstName.fill('Guntur Depot')
  await page.locator('[data-testid="destination-sublabel"]').first().fill('99 units')
  await page.waitForTimeout(300)

  // --- reorder --------------------------------------------------------------
  const namesBefore = await page.locator('[data-testid="destination-name"]').evaluateAll(
    (els) => els.map((e) => e.value),
  )
  await page.locator('[data-testid="move-down"]').first().click()
  const namesAfter = await page.locator('[data-testid="destination-name"]').evaluateAll(
    (els) => els.map((e) => e.value),
  )
  assert(namesAfter[0] === namesBefore[1] && namesAfter[1] === namesBefore[0],
    'the reorder control swaps adjacent destinations',
    `${namesBefore.slice(0, 2)} -> ${namesAfter.slice(0, 2)}`)

  // --- drag reorder ---------------------------------------------------------
  const beforeDrag = await page.locator('[data-testid="destination-name"]').evaluateAll(
    (els) => els.map((e) => e.value),
  )
  await page
    .locator('[data-testid="destination-item"]')
    .first()
    .dragTo(page.locator('[data-testid="destination-item"]').nth(3))
  const afterDrag = await page.locator('[data-testid="destination-name"]').evaluateAll(
    (els) => els.map((e) => e.value),
  )
  assert(afterDrag[3] === beforeDrag[0] && afterDrag[0] === beforeDrag[1],
    'dragging a destination onto a later row moves it there',
    `${JSON.stringify(beforeDrag.slice(0, 4))} -> ${JSON.stringify(afterDrag.slice(0, 4))}`)

  // --- remove ---------------------------------------------------------------
  await page.locator('[data-testid="remove-destination"]').first().click()
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="destination-item"]').length === n,
    6,
    { timeout: 10000 },
  )
  ok('removing a destination works')

  // --- the stage tracks edits ----------------------------------------------
  const legCount = await page.evaluate(() => window.__stage.getTimeline().legs.length)
  assert(legCount === 6, 'the render timeline follows the edited destination list',
    `${legCount} legs`)

  // --- persistence ----------------------------------------------------------
  await page.fill('[data-testid="project-name"]', 'Pharmacy run A')
  // Wait on what actually landed in storage; the status label can still be
  // showing the timestamp of an earlier autosave.
  await page.waitForFunction(
    () => {
      const projects = JSON.parse(localStorage.getItem('parcelmap.projects.v1') ?? '[]')
      return projects[0]?.name === 'Pharmacy run A' && projects[0]?.destinations.length === 6
    },
    undefined,
    { timeout: 15000 },
  )

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('parcelmap.projects.v1')
    const projects = JSON.parse(raw ?? '[]')
    return {
      count: projects.length,
      name: projects[0]?.name,
      destinations: projects[0]?.destinations.length,
      hasGeoCache: localStorage.getItem('parcelmap.geocache.v1') != null,
      currentId: localStorage.getItem('parcelmap.currentProject.v1'),
      firstDestName: projects[0]?.destinations[0]?.name,
      firstDestSub: projects[0]?.destinations[0]?.subLabel,
    }
  })
  console.log('  storage:', JSON.stringify(stored))

  assert(stored.name === 'Pharmacy run A', 'the project is written to localStorage')
  assert(stored.destinations === 6, 'destinations persist', `${stored.destinations}`)
  assert(stored.hasGeoCache, 'the geocode cache is persisted to localStorage')
  assert(stored.currentId != null, 'the current project id is remembered')

  // Reload and confirm it comes back.
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })
  const reloadedName = await page.inputValue('[data-testid="project-name"]')
  const reloadedCount = await page.locator('[data-testid="destination-item"]').count()
  assert(reloadedName === 'Pharmacy run A', 'the project reopens after a reload', reloadedName)
  assert(reloadedCount === 6, 'destinations survive the reload', `${reloadedCount}`)

  const renamed = await page.locator('[data-testid="destination-name"]').first().inputValue()
  assert(renamed.length > 0, 'edited names survive the reload', renamed)

  // --- new project ----------------------------------------------------------
  await page.click('[data-testid="new-project"]')
  await page.waitForSelector('[data-testid="no-origin"]', { timeout: 10000 })
  ok('a new project starts empty and prompts for an origin')

  const exportBlocked = await page.locator('[data-testid="render-button"]').isDisabled()
  assert(exportBlocked, 'export is blocked until the scene is complete')

  await page.waitForTimeout(1200)
  const afterNew = await page.evaluate(
    () => JSON.parse(localStorage.getItem('parcelmap.projects.v1') ?? '[]').length,
  )
  assert(afterNew === 1,
    'an untouched new project is not written to storage',
    `${afterNew} projects stored`)

  await page.screenshot({ path: resolve(outDir, '05-editor.png') })

  // Reopening the saved project from the picker.
  await page.selectOption('[data-testid="project-picker"]', { label: 'Pharmacy run A (6)' })
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="destination-item"]').length === n,
    6,
    { timeout: 15000 },
  )
  ok('the project picker reopens a saved project')
} finally {
  await browser.close()
  await server.stop()
}
