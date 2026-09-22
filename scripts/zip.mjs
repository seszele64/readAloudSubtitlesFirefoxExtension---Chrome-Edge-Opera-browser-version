// Packages the built extension (dist/) into a store-uploadable zip without
// adding a dependency: entry payloads are deflated with node:zlib and the ZIP
// container (local headers + central directory + EOCD) is written by hand.
// Output is reproducible: entries are sorted by path, DOS timestamps are a
// fixed constant, and the compression level is pinned.
//
// Usage: npm run zip  (after npm run build)
import { deflateRawSync, crc32 } from 'node:zlib'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dist = 'dist'
const zipStem = 'youtube-subtitle-reader'

// Fixed timestamp 1980-01-01 00:00:00 (earliest value DOS dates can express).
const dosTime = 0
const dosDate = (1 << 5) | 1 // ((1980 - 1980) << 9) | (month 1 << 5) | day 1
const versionMadeBy = (3 << 8) | 20 // host system Unix, PKZIP 2.0 spec
const versionNeeded = 20
const methodDeflate = 8
const compressionLevel = 9

async function listDistFiles(dir, prefix = '') {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await listDistFiles(path.join(dir, entry.name), rel)))
    } else if (entry.isFile()) {
      files.push(rel)
    } else {
      throw new Error(`unsupported dist entry (not a file or directory): ${rel}`)
    }
  }
  return files
}

function nameBuffer(relPath) {
  if (!/^[ -~]+$/.test(relPath)) {
    throw new Error(`dist path is not ASCII (unsupported without UTF-8 zip flag): ${relPath}`)
  }
  return Buffer.from(relPath, 'utf8')
}

// Accumulates little-endian fields for one ZIP structure table.
class ZipWriter {
  #chunks = []

  u16(value) {
    const buf = Buffer.alloc(2)
    buf.writeUInt16LE(value)
    this.#chunks.push(buf)
    return this
  }

  u32(value) {
    const buf = Buffer.alloc(4)
    buf.writeUInt32LE(value)
    this.#chunks.push(buf)
    return this
  }

  raw(buf) {
    this.#chunks.push(buf)
    return this
  }

  byteLength() {
    return this.#chunks.reduce((sum, buf) => sum + buf.length, 0)
  }

  toBuffer() {
    return Buffer.concat(this.#chunks)
  }
}

let manifest
try {
  manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'))
} catch {
  throw new Error(`cannot read ${dist}/manifest.json - run \`npm run build\` first`)
}
const { version } = manifest
if (typeof version !== 'string' || !/^[\w.-]+$/.test(version)) {
  throw new Error(`manifest.json has no usable version field: ${JSON.stringify(version)}`)
}
const zipPath = `${zipStem}-${version}.zip`

const entries = []
for (const rel of (await listDistFiles(dist)).sort()) {
  const content = await readFile(path.join(dist, rel))
  entries.push({
    name: nameBuffer(rel),
    compressed: deflateRawSync(content, { level: compressionLevel }),
    crc: crc32(content),
    uncompressedSize: content.length,
  })
}

const local = new ZipWriter()
const central = new ZipWriter()
let localOffset = 0
for (const entry of entries) {
  const { name, compressed, crc, uncompressedSize } = entry
  local
    .u32(0x04034b50) // local file header signature
    .u16(versionNeeded)
    .u16(0) // general purpose flags (no UTF-8 flag: names are ASCII)
    .u16(methodDeflate)
    .u16(dosTime)
    .u16(dosDate)
    .u32(crc)
    .u32(compressed.length)
    .u32(uncompressedSize)
    .u16(name.length)
    .u16(0) // extra field length
    .raw(name)
    .raw(compressed)

  central
    .u32(0x02014b50) // central directory header signature
    .u16(versionMadeBy)
    .u16(versionNeeded)
    .u16(0) // general purpose flags
    .u16(methodDeflate)
    .u16(dosTime)
    .u16(dosDate)
    .u32(crc)
    .u32(compressed.length)
    .u32(uncompressedSize)
    .u16(name.length)
    .u16(0) // extra field length
    .u16(0) // comment length
    .u16(0) // disk number start
    .u16(0) // internal file attributes
    .u32(0) // external file attributes
    .u32(localOffset)
    .raw(name)

  localOffset += 30 + name.length + compressed.length
}

const centralDirectory = central.toBuffer()
const zip = local
  .raw(centralDirectory)
  .u32(0x06054b50) // end of central directory signature
  .u16(0) // disk number
  .u16(0) // disk with central directory
  .u16(entries.length)
  .u16(entries.length)
  .u32(centralDirectory.length)
  .u32(localOffset)
  .u16(0) // comment length
  .toBuffer()

await writeFile(zipPath, zip)
console.log(`[zip] wrote ${zipPath} (${entries.length} entries, ${zip.length} bytes)`)
