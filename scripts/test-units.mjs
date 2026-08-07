/**
 * Pure-function checks for the arc geometry and the frame timeline. These run
 * under Node with type stripping, no browser involved.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const geo = await import('../src/lib/geo.ts')
const timeline = await import('../src/lib/timeline.ts')
const easing = await import('../src/lib/easing.ts')

const HUB = { lng: 80.648, lat: 16.5062 } // Vijayawada
const GUNTUR = { lng: 80.4365, lat: 16.3067 }
const KAKINADA = { lng: 82.2475, lat: 16.9891 }

test('mercator projection round-trips', () => {
  for (const [lng, lat] of [
    [80.648, 16.5062],
    [-73.9, 40.7],
    [0, 0],
    [179.9, -84],
  ]) {
    const [x, y] = geo.projectMercator(lng, lat)
    const [lng2, lat2] = geo.unprojectMercator(x, y)
    assert.ok(Math.abs(lng - lng2) < 1e-9, `lng ${lng} -> ${lng2}`)
    assert.ok(Math.abs(lat - lat2) < 1e-9, `lat ${lat} -> ${lat2}`)
  }
})

test('arc samples 64 points, endpoints exact', () => {
  const arc = geo.buildArc(HUB, GUNTUR)
  assert.equal(arc.points.length, 64)

  const [firstLng, firstLat] = arc.points[0]
  assert.ok(Math.abs(firstLng - HUB.lng) < 1e-9)
  assert.ok(Math.abs(firstLat - HUB.lat) < 1e-9)

  const [lastLng, lastLat] = arc.points[63]
  assert.ok(Math.abs(lastLng - GUNTUR.lng) < 1e-9)
  assert.ok(Math.abs(lastLat - GUNTUR.lat) < 1e-9)
})

test('control point sits perpendicular to the chord at 0.25 of its length', () => {
  const arc = geo.buildArc(HUB, KAKINADA, { curvature: 0.25 })
  const chord = [arc.b[0] - arc.a[0], arc.b[1] - arc.a[1]]
  const chordLen = Math.hypot(chord[0], chord[1])
  const mid = [(arc.a[0] + arc.b[0]) / 2, (arc.a[1] + arc.b[1]) / 2]
  const offset = [arc.c[0] - mid[0], arc.c[1] - mid[1]]

  // Magnitude is 0.25 * chord length.
  assert.ok(
    Math.abs(Math.hypot(offset[0], offset[1]) - 0.25 * chordLen) < 1e-12,
    'offset magnitude',
  )
  // And it is perpendicular: dot product with the chord is zero.
  const dot = offset[0] * chord[0] + offset[1] * chord[1]
  assert.ok(Math.abs(dot) < 1e-12, `offset not perpendicular, dot=${dot}`)
})

test('arc bows away from the straight chord (not a flat line)', () => {
  const arc = geo.buildArc(HUB, GUNTUR)
  const mid = arc.points[32]
  const straightMid = [(HUB.lng + GUNTUR.lng) / 2, (HUB.lat + GUNTUR.lat) / 2]
  const deviationDeg = Math.hypot(mid[0] - straightMid[0], mid[1] - straightMid[1])
  const chordDeg = Math.hypot(GUNTUR.lng - HUB.lng, GUNTUR.lat - HUB.lat)
  // A quadratic bezier peaks at half the control offset, so ~12.5% of chord.
  const ratio = deviationDeg / chordDeg
  assert.ok(ratio > 0.1 && ratio < 0.15, `bow ratio ${ratio.toFixed(4)} outside expected band`)
})

test('every spoke bows to the same side of its chord', () => {
  const dests = [
    { lng: 80.4365, lat: 16.3067 },
    { lng: 82.2475, lat: 16.9891 },
    { lng: 80.049, lat: 15.5057 },
    { lng: 81.0952, lat: 16.7107 },
  ]
  const signs = dests.map((d) => {
    const arc = geo.buildArc(HUB, d)
    const chord = [arc.b[0] - arc.a[0], arc.b[1] - arc.a[1]]
    const mid = [(arc.a[0] + arc.b[0]) / 2, (arc.a[1] + arc.b[1]) / 2]
    const offset = [arc.c[0] - mid[0], arc.c[1] - mid[1]]
    return Math.sign(chord[0] * offset[1] - chord[1] * offset[0])
  })
  assert.ok(signs.every((s) => s === signs[0]), `mixed bow directions: ${signs}`)
})

test('sliceArc reveals monotonically and ends at the destination', () => {
  const arc = geo.buildArc(HUB, KAKINADA)
  assert.equal(geo.sliceArc(arc, 0).length, 0)

  let previous = 0
  for (let t = 0.02; t <= 1.0001; t += 0.02) {
    const slice = geo.sliceArc(arc, Math.min(t, 1))
    assert.ok(slice.length >= 2, `t=${t.toFixed(2)} produced ${slice.length} points`)
    assert.ok(slice.length >= previous, `t=${t.toFixed(2)} went backwards`)
    previous = slice.length

    // The tip must lie on the curve at exactly t.
    const tip = slice[slice.length - 1]
    const expected = geo.arcPointAt(arc, Math.min(t, 1))
    assert.ok(Math.abs(tip[0] - expected[0]) < 1e-9, 'tip lng')
    assert.ok(Math.abs(tip[1] - expected[1]) < 1e-9, 'tip lat')
  }

  const full = geo.sliceArc(arc, 1)
  const end = full[full.length - 1]
  assert.ok(Math.abs(end[0] - KAKINADA.lng) < 1e-9)
  assert.ok(Math.abs(end[1] - KAKINADA.lat) < 1e-9)
})

test('sliceArc tip advances smoothly between samples', () => {
  // Between two adjacent samples the tip should move a little, not snap.
  const arc = geo.buildArc(HUB, KAKINADA)
  const a = geo.sliceArc(arc, 0.5)
  const b = geo.sliceArc(arc, 0.505)
  const tipA = a[a.length - 1]
  const tipB = b[b.length - 1]
  const moved = Math.hypot(tipB[0] - tipA[0], tipB[1] - tipA[1])
  assert.ok(moved > 0, 'tip did not move for a sub-sample step')
})

test('timeline matches the documented default shape', () => {
  // 0.6s/destination at 30fps => 18 frame stagger, 36 frame arc draw.
  const t = timeline.computeTimeline(5, 0.6)
  assert.equal(t.stagger, 18)
  assert.equal(t.legs[0].arcFrames, 36)
  assert.equal(t.legs[0].startFrame, timeline.HUB_IN_FRAMES)
  assert.equal(t.legs[1].startFrame, timeline.HUB_IN_FRAMES + 18)
  assert.equal(t.legs[4].startFrame, timeline.HUB_IN_FRAMES + 72)

  const lastArrival = t.legs[4].arriveFrame
  assert.equal(t.outroStart, lastArrival + timeline.ARRIVAL_FRAMES)
  assert.equal(t.totalFrames, t.outroStart + timeline.OUTRO_FRAMES)
})

test('hub owns frames 0-45 before any arc starts', () => {
  const t = timeline.computeTimeline(3, 0.6)
  for (let f = 0; f < timeline.HUB_IN_FRAMES; f++) {
    const s = timeline.frameState(t, f)
    assert.ok(s.legs.every((leg) => leg.t === 0), `leg drawing at frame ${f}`)
  }
  assert.equal(timeline.frameState(t, 0).hub.drop, 0)
  assert.ok(timeline.frameState(t, 24).hub.drop >= 1, 'hub fully dropped by frame 24')
})

test('leg reveal is monotonic and complete on arrival', () => {
  const t = timeline.computeTimeline(6, 0.6)
  for (const leg of t.legs) {
    let previous = -1
    for (let f = 0; f < t.totalFrames; f++) {
      const s = timeline.frameState(t, f).legs[leg.index]
      assert.ok(s.t >= previous - 1e-12, `leg ${leg.index} reversed at frame ${f}`)
      previous = s.t
    }
    assert.ok(timeline.frameState(t, leg.arriveFrame).legs[leg.index].t >= 0.9999,
      `leg ${leg.index} not complete at arrival`)
    assert.equal(timeline.frameState(t, leg.startFrame - 1).legs[leg.index].t, 0)
  }
})

test('pins and labels only appear after their parcel arrives', () => {
  const t = timeline.computeTimeline(4, 0.6)
  for (const leg of t.legs) {
    const atArrival = timeline.frameState(t, leg.arriveFrame).legs[leg.index]
    assert.equal(atArrival.pin, 0, `leg ${leg.index} pin early`)
    const later = timeline.frameState(t, leg.arriveFrame + timeline.ARRIVAL_FRAMES).legs[leg.index]
    assert.ok(later.pin > 0.9, `leg ${leg.index} pin did not drop`)
    assert.ok(later.label > 0, `leg ${leg.index} label did not fade in`)
  }
})

test('counter animates to the destination count over the final hold', () => {
  const t = timeline.computeTimeline(12, 0.6)
  assert.equal(timeline.frameState(t, t.outroStart - 1).counter.opacity, 0)
  const end = timeline.frameState(t, t.totalFrames - 1).counter
  assert.ok(end.opacity > 0.99, 'counter not visible at the end')
  assert.ok(Math.abs(end.value - 12) < 0.01, `counter ended at ${end.value}`)
})

test('all arcs stay fully drawn through the outro', () => {
  const t = timeline.computeTimeline(8, 0.6)
  for (let f = t.outroStart; f < t.totalFrames; f++) {
    const s = timeline.frameState(t, f)
    assert.ok(s.legs.every((leg) => leg.t >= 0.9999), `an arc receded at frame ${f}`)
  }
})

test('seconds-per-destination scales the clip length', () => {
  const fast = timeline.computeTimeline(10, 0.3)
  const slow = timeline.computeTimeline(10, 1.2)
  assert.ok(slow.totalFrames > fast.totalFrames * 2, 'slower setting did not lengthen the clip')
  assert.equal(fast.stagger, 9)
  assert.equal(slow.stagger, 36)
})

test('easings are clamped and hit their endpoints', () => {
  for (const fn of [easing.easeInOutCubic, easing.easeOutCubic, easing.easeOutQuad]) {
    assert.equal(fn(0), 0)
    assert.equal(fn(1), 1)
    assert.equal(fn(-5), 0)
    assert.equal(fn(5), 1)
  }
  assert.equal(easing.easeOutBack(0), 0)
  assert.ok(Math.abs(easing.easeOutBack(1) - 1) < 1e-12)
})
