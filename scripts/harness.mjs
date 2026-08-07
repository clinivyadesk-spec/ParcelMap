import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import http from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DIST = resolve(ROOT, 'dist')
export const OUT_DIR = resolve(ROOT, '.verify')

const CHROMIUM =
  process.env.PARCELMAP_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // MapLibre 6 spawns a module worker from a .mjs asset; Chromium enforces a
  // JavaScript MIME type on module workers, so this entry is load-bearing.
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/**
 * Serve the production build over loopback. WebCodecs needs a secure context
 * and http://127.0.0.1 counts as one, so no TLS is required.
 */
export async function startServer() {
  if (!existsSync(DIST)) throw new Error(`no build found at ${DIST} — run "npm run build" first`)

  const server = http.createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    const safe = normalize(rawPath).replace(/^(\.\.[/\\])+/, '')
    let filePath = join(DIST, safe)

    if (!filePath.startsWith(DIST)) {
      res.writeHead(403).end('forbidden')
      return
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(DIST, 'index.html')
    }
    if (!existsSync(filePath)) {
      res.writeHead(404).end('not found')
      return
    }

    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    createReadStream(filePath).pipe(res)
  })

  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((r) => server.close(r))
    },
  }
}

export async function launchBrowser() {
  return chromium.launch({
    executablePath: CHROMIUM,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-lcd-text',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
}

export async function newPage(browser, { viewport = { width: 1400, height: 1000 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('console', (msg) => {
    const type = msg.type()
    if (type === 'error' || type === 'warning') console.log(`  [browser:${type}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
  return page
}

export function ensureOutDir() {
  mkdirSync(OUT_DIR, { recursive: true })
  return OUT_DIR
}

export function ok(label) {
  console.log(`  ✓ ${label}`)
}

export function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`)
  process.exitCode = 1
}

export function assert(condition, label, detail) {
  if (condition) ok(label)
  else fail(label, detail)
  return Boolean(condition)
}
