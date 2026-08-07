# ParcelMap

Turn a dispatch hub and a list of towns into a hub-and-spoke delivery
animation, and export it as an MP4 — entirely in the browser. No backend, no
render farm, no API keys.

Built for the case of a distributor in Vijayawada who ships to 10–20 towns
across Andhra Pradesh and wants a 9:16 clip of today's run.

```
npm install
npm run dev
```

## What it does

Enter one origin city and any number of destinations, then hit **Render MP4**.
You get a video of arcs fanning out from the hub to each town, with a pin drop
and label on each arrival and a counter at the end.

- **Editor** — origin + destination search, drag to reorder, editable labels
  and sub-labels ("24 units"), title/subtitle, aspect ratio, arc colour,
  basemap and pacing.
- **Preview** — a scrubbable timeline that drives the *same* render function
  the exporter calls, so the preview is the output. It is not a scaled-down
  approximation: the stage lives at true output resolution (1080×1920 and
  friends) and is scaled down with a CSS transform for display.
- **Export** — frame-by-frame H.264 into an MP4, written with WebCodecs and
  mp4-muxer.

## Requirements

**Chrome or Edge on desktop.** Export needs the WebCodecs `VideoEncoder` API
with an H.264 encoder. The app feature-detects this on load and says so
plainly rather than failing halfway through a render. Everything else — the
editor and the preview — works in any modern browser.

WebCodecs also requires a secure context, so serve over HTTPS (or localhost).

## How the export works

The critical property is that **nothing is captured in real time**. There is no
`MediaRecorder` and no `canvas.captureStream`; both drop frames under load and
produce WebM. Instead the loop advances one frame at a time and waits for the
map before reading pixels:

```
for each frame i:
  update the GeoJSON sources for frame i
  map.jumpTo(cameraAt(i))          // jumpTo, never flyTo/easeTo
  await map idle (with a timeout)  // no half-drawn tiles
  drawImage(map canvas) + draw overlays
  encoder.encode(new VideoFrame(...), { keyFrame: i % 60 === 0 })
  if the encode queue backs up, wait for it to drain
```

Details that matter:

- MapLibre is created with `preserveDrawingBuffer: true` (so the WebGL
  backbuffer is still readable after the paint), `fadeDuration: 0`,
  `interactive: false`, and `pixelRatio: 1` so `getCanvas()` is exactly the
  output size regardless of the user's display density.
- Waiting on idle also forces a synchronous `map.redraw()`, so a throttled tab
  cannot stall the loop indefinitely.
- Backpressure waits on the encoder's `dequeue` event rather than calling
  `flush()`, which would force the encoder to emit everything it holds and
  cost compression efficiency.
- The codec is chosen by asking `VideoEncoder.isConfigSupported` — High @ 4.0
  (`avc1.640028`) first, then Baseline (`avc1.42001f`).
- Attribution is drawn onto the overlay canvas. MapLibre's attribution control
  is a DOM node, so it never appears in the captured WebGL canvas; without
  this the exported file would carry no OSM credit.

A 12-destination clip is around 350 frames and takes roughly 1–3 minutes.
Keep the tab focused while it runs.

## Animation

- The camera is **static** by default — `fitBounds` over every point, computed
  once. An optional toggle backs it off by 5% of scale across the clip.
- Arcs are **quadratic beziers in Mercator space**, not great circles. Over a
  couple of hundred kilometres a great circle is visually a straight line,
  which is exactly the look we want to avoid. The control point is offset
  perpendicular to the chord by 0.25 of its length, always rotated the same
  way so the whole fan bows consistently.
- Each arc is sampled at 64 points and revealed by slicing that array, with
  the exact curve point at `t` appended so the leading tip advances smoothly
  instead of snapping between samples.
- Timing: hub drops in over frames 0–45, then destinations reveal staggered by
  the seconds-per-destination setting (0.6s → 18 frames) with each arc drawing
  over twice that, then a 60-frame hold while the counter counts up.
- Overlays (title, subtitle, place chips, counter, wordmark, attribution) are
  drawn on a separate 2D canvas composited over the map canvas — never as map
  layers. Chips are placed by scoring candidate slots against everything
  already placed, and a displaced chip gets a dashed leader line back to its
  pin.

## Geocoding

Nominatim, debounced at 800ms, restricted to `countrycodes=in`, with results
cached in `localStorage` so reopening a project does no network traffic.
Requests are serialised at least a second apart.

Small towns are often missing from the index, so **raw `lat, lng` input is
always accepted** — paste `16.5062, 80.648` and it becomes a pin without
touching the geocoder.

One caveat: browsers refuse to let `fetch` set `User-Agent` (it is a forbidden
header name and is dropped silently), so the identifying header in
`src/lib/geocode.ts` is best-effort. The parts of the usage policy that can be
honoured from a browser — rate limiting and caching — are enforced.

## Basemaps

[OpenFreeMap](https://openfreemap.org) Positron and Liberty. No account, no
token, no key, anywhere in the app. If the tile host is unreachable the app
falls back to a bundled offline grid style rather than showing a dead grey
rectangle, and says so in the sidebar.

## Storage

Projects autosave to `localStorage` and reopen on reload. Stored data is
normalised on read, so a project written by an older build is repaired rather
than discarded. Nothing leaves the machine except geocoding queries and map
tiles.

## Deploying

ParcelMap is a fully static single-page app — no backend, no server-side
rendering, no environment variables, no secrets to configure. Any static host
works; the repo is set up for **Cloudflare Pages**.

Build command `npm run build`, output directory `dist`.

HTTPS matters here beyond the usual reasons: WebCodecs only exposes
`VideoEncoder` in a secure context, so MP4 export simply will not appear on a
plain-HTTP host. Pages is HTTPS by default.

### Option A — connect the repo in the dashboard (no secrets)

The quickest path, and it auto-deploys on every push.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, and pick this repository.
2. Settings:
   - Framework preset: **Vite** (or None)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: pinned by the `.node-version` file in the repo, so there is
     normally nothing to set. If your build image ignores it, add a
     `NODE_VERSION=22` build environment variable — Vite 8 needs Node
     20.19+/22.12+ and an older default is the most common build failure.

### Confirming which build is live

The footer of the export panel shows `build <sha>`, taken from
`CF_PAGES_COMMIT_SHA`. If it does not match the commit you expect, the deploy
is stale — which is worth checking before assuming the app is misbehaving,
because a stale bundle and a stale saved project look identical from the
outside.
3. Deploy. You get `https://parcelmap.pages.dev`, plus a distinct preview URL
   for every branch, so the `claude/parcelmap-delivery-animation-wa9zsf`
   branch gets its own URL without touching production.

### Option B — deploy from your machine

```
npm run build
npx wrangler pages deploy        # reads wrangler.toml
```

`wrangler` will open a browser to authenticate the first time.

### Option C — GitHub Actions

`.github/workflows/deploy.yml` builds, lints, runs the unit tests and deploys
on push. It needs two repository secrets:

- `CLOUDFLARE_API_TOKEN` — an API token with the **Cloudflare Pages: Edit**
  permission
- `CLOUDFLARE_ACCOUNT_ID` — from the dashboard sidebar

Without those secrets the workflow's deploy step fails; the build and test
steps still run, so it doubles as CI.

### What ships alongside the build

- `public/_headers` — immutable caching for the fingerprinted `/assets/*`
  files and `no-cache` for `index.html`, plus `nosniff` and a referrer policy.
  It deliberately does **not** set `Cross-Origin-Embedder-Policy`: that would
  require every basemap tile to carry `Cross-Origin-Resource-Policy`, which
  OpenFreeMap does not send, and the map would silently stop loading.
- `public/_redirects` — SPA fallback so a refresh on any path serves the app.

Both are copied to the root of `dist/` by Vite and consumed by Pages.

## Development

```
npm run dev        # vite dev server
npm run build      # typecheck + production build
npm run lint
npm run test       # pure unit tests (geometry, timeline, easing)
npm run verify     # the whole suite, including headless render checks
```

### Verification

`npm run verify` runs the unit tests and then drives a real production build in
headless Chromium:

| script | what it proves |
| --- | --- |
| `verify:stage` | MapLibre paints, the canvas is exactly the output size, `fitBounds` contains every point |
| `verify:animation` | arcs reveal progressively, pins land after arrival, overlays composite, no label chip ever overlaps another |
| `verify:editor` | geocode URL and parameters, debounce, cache, coordinate fallback, reorder/rename/remove, save + reload round trip |
| `verify:settings` | all three aspect ratios resize the stage, canvas and camera; colour, pacing, zoom-out and basemap swapping |
| `verify:export` | clicks Render, captures the real download, parses the MP4 box structure, then decodes the file back in the browser |

The export check parses the file with a small ISO-BMFF reader
(`scripts/mp4-inspect.mjs`) — `ftyp`/`moov`/`mdat` present, no truncated boxes,
`moov` before `mdat` (fast start), sample count matching the frame count, a
1080×1920 track, key frames at the requested cadence, no zero-length samples —
and then loads the blob into a `<video>`, seeks to four timestamps and reads
back pixels to confirm real animated content.

### Debug query flags

Not needed for normal use; the render tests rely on them.

| flag | effect |
| --- | --- |
| `?style=offline` | force a basemap, including the bundled no-network one |
| `?codec=vp09.00.10.08` | override the codec probe order |
| `?frames=90` | cap the export length for a quick test clip |

### Sandbox notes

Two things could not be exercised in the environment this was built in, both
environmental rather than gaps in the app:

- **H.264 encoding.** Playwright's Chromium is built without proprietary
  codecs, so `avc1.*` is unavailable there. The export test drives the
  identical loop with VP9 through `?codec=`; the H.264 path differs only in
  the codec string and the muxer's track tag. Run `npm run verify:export`
  without the override on a machine with real Chrome to exercise it.
- **Live network calls.** `tiles.openfreemap.org` and
  `nominatim.openstreetmap.org` are blocked by the sandbox's egress policy.
  The tests intercept those requests and assert on the exact URLs the app
  builds, so the request contract is covered even though the responses are
  fixtures.
