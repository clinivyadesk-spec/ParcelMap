/**
 * Step 4 check: click Render, capture the real download, and prove the file
 * is a valid MP4 that decodes back to the frames we drew.
 *
 * Note on codecs: Playwright's Chromium is built without proprietary codecs,
 * so `avc1.*` is unavailable here and the test drives the same export loop
 * with VP9 via the ?codec= override. Everything except the four-character
 * codec string is the identical code path the shipped H.264 export uses.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assert, ensureOutDir, launchBrowser, newPage, ok, startServer } from './harness.mjs'
import { inspectMp4 } from './mp4-inspect.mjs'

const CODEC = process.env.PARCELMAP_TEST_CODEC ?? 'vp09.00.10.08'
const FRAMES = Number(process.env.PARCELMAP_TEST_FRAMES ?? 90) // 3 seconds at 30fps
const FPS = 30

const outDir = ensureOutDir()
const server = await startServer()
const browser = await launchBrowser()

try {
  const page = await newPage(browser, { viewport: { width: 1400, height: 1000 } })
  await page.goto(
    `${server.url}/?style=offline&codec=${encodeURIComponent(CODEC)}&frames=${FRAMES}`,
    { waitUntil: 'load' },
  )
  await page.waitForFunction(() => window.__stage != null, undefined, { timeout: 90000 })
  ok('stage ready')

  const unsupported = await page.$('[data-testid="webcodecs-unsupported"]')
  assert(!unsupported, 'WebCodecs is available and the export UI is live')

  const downloadPromise = page.waitForEvent('download', { timeout: 300000 })
  const startedAt = Date.now()
  await page.click('[data-testid="render-button"]')
  ok('render started')

  // Progress must actually advance, not sit at zero.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="export-frame-count"]')
      if (!el) return false
      const m = /frame (\d+)\//.exec(el.textContent ?? '')
      return m != null && Number(m[1]) > 3
    },
    undefined,
    { timeout: 120000 },
  )
  ok('progress bar reports advancing frames')

  const download = await downloadPromise
  const mp4Path = resolve(outDir, 'parcelmap-test.mp4')
  await download.saveAs(mp4Path)
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  ok(`download captured as ${download.suggestedFilename()} in ${elapsed}s`)

  assert(download.suggestedFilename().endsWith('.mp4'),
    'download is named .mp4', download.suggestedFilename())

  const buffer = readFileSync(mp4Path)
  const info = inspectMp4(buffer)
  console.log('  mp4:', JSON.stringify({
    bytes: info.bytes,
    topLevel: info.topLevel,
    brands: info.brands,
    fastStart: info.fastStart,
    durationSeconds: info.durationSeconds,
    sampleCount: info.sampleCount,
    keyFrameCount: info.keyFrameCount,
    sampleEntry: info.sampleEntryType,
    dims: `${info.width}x${info.height}`,
    stts: info.timeToSample,
  }))

  assert(info.hasFtyp && info.hasMoov && info.hasMdat,
    'file has ftyp, moov and mdat boxes',
    JSON.stringify(info.topLevel))

  assert(info.truncatedBoxes.length === 0,
    'no truncated boxes — the file is complete',
    JSON.stringify(info.truncatedBoxes))

  assert(info.fastStart, 'moov precedes mdat (fastStart: in-memory worked)')

  assert(info.sampleCount === FRAMES,
    `sample table holds exactly ${FRAMES} frames`,
    `got ${info.sampleCount}`)

  assert(info.sttsSampleCount === FRAMES,
    'time-to-sample table agrees with the sample count',
    `stts=${info.sttsSampleCount}`)

  assert(info.width === 1080 && info.height === 1920,
    'track dimensions are 1080x1920',
    `${info.width}x${info.height}`)

  const expectedDuration = FRAMES / FPS
  assert(Math.abs(info.durationSeconds - expectedDuration) < 0.1,
    `duration is ${expectedDuration}s`,
    `got ${info.durationSeconds}`)

  assert(info.keyFrameCount >= Math.floor(FRAMES / 60),
    'key frames were written at the requested cadence',
    `keyFrames=${JSON.stringify(info.keyFrames)}`)

  assert(info.minSampleBytes > 0,
    'every frame carries encoded data (no zero-length samples)',
    `min=${info.minSampleBytes} max=${info.maxSampleBytes}`)

  assert(info.mdatBytes > 20_000,
    'mdat holds a plausible amount of video data',
    `${info.mdatBytes} bytes`)

  // The real proof: hand the file back to the browser and decode it.
  const playback = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = url

    const meta = await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('metadata timeout')), 20000)
      video.onloadedmetadata = () => {
        clearTimeout(timer)
        res({ duration: video.duration, w: video.videoWidth, h: video.videoHeight })
      }
      video.onerror = () => {
        clearTimeout(timer)
        rej(new Error(`video error: ${video.error?.code} ${video.error?.message ?? ''}`))
      }
    })

    // Seek to a few timestamps and read back pixels to confirm real frames.
    const canvas = document.createElement('canvas')
    canvas.width = 270
    canvas.height = 480
    const ctx = canvas.getContext('2d')
    const seekTo = async (t) => {
      await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`seek to ${t} timed out`)), 15000)
        video.onseeked = () => { clearTimeout(timer); res() }
        video.currentTime = t
      })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const colours = new Set()
      let sum = 0
      for (let i = 0; i < data.length; i += 4 * 13) {
        colours.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`)
        sum += data[i] + data[i + 1] + data[i + 2]
      }
      return { t, colours: colours.size, mean: Math.round(sum / (data.length / (4 * 13)) / 3) }
    }

    const frames = []
    for (const t of [0, 1, 2, Math.max(0, meta.duration - 0.1)]) frames.push(await seekTo(t))

    // Also confirm it genuinely plays forward.
    await video.play()
    await new Promise((r) => setTimeout(r, 600))
    const advanced = video.currentTime
    video.pause()
    URL.revokeObjectURL(url)

    return { meta, frames, advanced }
  }, Array.from(buffer))

  console.log('  playback:', JSON.stringify(playback))

  assert(Math.abs(playback.meta.duration - expectedDuration) < 0.2,
    'the browser reports the expected duration on playback',
    `${playback.meta.duration}`)

  assert(playback.meta.w === 1080 && playback.meta.h === 1920,
    'decoded video is 1080x1920',
    `${playback.meta.w}x${playback.meta.h}`)

  assert(playback.frames.every((f) => f.colours > 20),
    'decoded frames contain real image detail, not a flat colour',
    JSON.stringify(playback.frames.map((f) => f.colours)))

  assert(playback.frames[0].colours !== playback.frames[3].colours ||
    playback.frames[0].mean !== playback.frames[3].mean,
    'the first and last decoded frames differ (the clip is animated)',
    JSON.stringify(playback.frames))

  assert(playback.advanced > 0.05, 'playback advances the current time',
    `currentTime=${playback.advanced}`)

  // Keep a decoded still for eyeballing.
  const still = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise((res) => { video.onloadedmetadata = res })
    await new Promise((res) => { video.onseeked = res; video.currentTime = video.duration - 0.05 })
    const c = document.createElement('canvas')
    c.width = video.videoWidth
    c.height = video.videoHeight
    c.getContext('2d').drawImage(video, 0, 0)
    URL.revokeObjectURL(url)
    return c.toDataURL('image/png')
  }, Array.from(buffer))
  writeFileSync(resolve(outDir, '04-decoded-lastframe.png'), Buffer.from(still.split(',')[1], 'base64'))
  ok('decoded final frame written to .verify/04-decoded-lastframe.png')

  const doneText = await page.textContent('[data-testid="export-done"]')
  console.log('  ui:', doneText?.replace(/\s+/g, ' ').trim())
} finally {
  await browser.close()
  await server.stop()
}
