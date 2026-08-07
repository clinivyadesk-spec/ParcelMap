/**
 * Minimal ISO base media file format reader. Enough to prove the exporter
 * produced a real, structurally sound, fast-start MP4 rather than a blob that
 * merely has the right extension.
 */

export function parseBoxes(buffer, start = 0, end = buffer.length, depth = 0) {
  const boxes = []
  let offset = start

  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    let headerSize = 8

    if (size === 1) {
      // 64-bit extended size.
      const hi = buffer.readUInt32BE(offset + 8)
      const lo = buffer.readUInt32BE(offset + 12)
      size = hi * 2 ** 32 + lo
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }

    if (size < headerSize || offset + size > end) {
      boxes.push({ type, offset, size, truncated: true })
      break
    }

    const box = { type, offset, size, headerSize }

    // Containers worth descending into.
    const CONTAINERS = new Set([
      'moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'mvex', 'moof', 'traf',
    ])
    if (CONTAINERS.has(type) && depth < 8) {
      box.children = parseBoxes(buffer, offset + headerSize, offset + size, depth + 1)
    }

    boxes.push(box)
    offset += size
  }

  return boxes
}

function find(boxes, path) {
  const [head, ...rest] = path
  for (const box of boxes) {
    if (box.type !== head) continue
    if (rest.length === 0) return box
    if (box.children) {
      const hit = find(box.children, rest)
      if (hit) return hit
    }
  }
  return null
}

function flatten(boxes, out = []) {
  for (const box of boxes) {
    out.push(box)
    if (box.children) flatten(box.children, out)
  }
  return out
}

/** Read the sample-table boxes that tell us frame count and key frames. */
function readSampleTables(buffer, stbl) {
  const result = {}
  if (!stbl?.children) return result

  for (const box of stbl.children) {
    const body = box.offset + box.headerSize
    if (box.type === 'stsz') {
      const sampleSize = buffer.readUInt32BE(body + 4)
      const count = buffer.readUInt32BE(body + 8)
      result.sampleCount = count
      result.uniformSampleSize = sampleSize
      if (sampleSize === 0) {
        let total = 0
        let min = Infinity
        let max = 0
        for (let i = 0; i < count; i++) {
          const s = buffer.readUInt32BE(body + 12 + i * 4)
          total += s
          min = Math.min(min, s)
          max = Math.max(max, s)
        }
        result.totalSampleBytes = total
        result.minSampleBytes = min === Infinity ? 0 : min
        result.maxSampleBytes = max
      }
    } else if (box.type === 'stss') {
      result.keyFrameCount = buffer.readUInt32BE(body + 4)
      result.keyFrames = []
      for (let i = 0; i < result.keyFrameCount && i < 64; i++) {
        result.keyFrames.push(buffer.readUInt32BE(body + 8 + i * 4))
      }
    } else if (box.type === 'stts') {
      const entryCount = buffer.readUInt32BE(body + 4)
      result.timeToSample = []
      let samples = 0
      for (let i = 0; i < entryCount; i++) {
        const count = buffer.readUInt32BE(body + 8 + i * 8)
        const delta = buffer.readUInt32BE(body + 12 + i * 8)
        result.timeToSample.push({ count, delta })
        samples += count
      }
      result.sttsSampleCount = samples
    } else if (box.type === 'stsd') {
      const entryCount = buffer.readUInt32BE(body + 4)
      if (entryCount > 0) {
        // stsd body: version+flags (4) + entry_count (4), then the entry box.
        const entry = body + 8
        result.sampleEntryType = buffer.toString('latin1', entry + 4, entry + 8)
        // VisualSampleEntry = box header (8) + SampleEntry reserved/index (8)
        // + pre_defined/reserved/pre_defined[3] (16), then width and height.
        result.width = buffer.readUInt16BE(entry + 32)
        result.height = buffer.readUInt16BE(entry + 34)
      }
    }
  }
  return result
}

export function inspectMp4(buffer) {
  const boxes = parseBoxes(buffer)
  const all = flatten(boxes)
  const topLevel = boxes.map((b) => b.type)

  const ftyp = boxes.find((b) => b.type === 'ftyp')
  const moov = boxes.find((b) => b.type === 'moov')
  const mdat = boxes.find((b) => b.type === 'mdat')

  const brands = []
  if (ftyp) {
    brands.push(buffer.toString('latin1', ftyp.offset + 8, ftyp.offset + 12))
    for (let o = ftyp.offset + 16; o + 4 <= ftyp.offset + ftyp.size; o += 4) {
      brands.push(buffer.toString('latin1', o, o + 4))
    }
  }

  const mvhd = find(boxes, ['moov', 'mvhd'])
  let durationSeconds = null
  if (mvhd) {
    const body = mvhd.offset + mvhd.headerSize
    const version = buffer.readUInt8(body)
    if (version === 0) {
      const timescale = buffer.readUInt32BE(body + 12)
      const duration = buffer.readUInt32BE(body + 16)
      durationSeconds = timescale ? duration / timescale : null
    } else {
      const timescale = buffer.readUInt32BE(body + 20)
      const hi = buffer.readUInt32BE(body + 24)
      const lo = buffer.readUInt32BE(body + 28)
      durationSeconds = timescale ? (hi * 2 ** 32 + lo) / timescale : null
    }
  }

  const stbl = find(boxes, ['moov', 'trak', 'mdia', 'minf', 'stbl'])
  const samples = readSampleTables(buffer, stbl)

  return {
    bytes: buffer.length,
    topLevel,
    brands,
    hasFtyp: Boolean(ftyp),
    hasMoov: Boolean(moov),
    hasMdat: Boolean(mdat),
    // Fast start means the index precedes the media payload.
    fastStart: Boolean(moov && mdat && moov.offset < mdat.offset),
    mdatBytes: mdat ? mdat.size - mdat.headerSize : 0,
    durationSeconds,
    truncatedBoxes: all.filter((b) => b.truncated).map((b) => b.type),
    boxTypes: [...new Set(all.map((b) => b.type))].sort(),
    ...samples,
  }
}
