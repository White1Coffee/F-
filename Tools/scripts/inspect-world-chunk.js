const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const worldDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'minecraft-java-server', 'world'))
const x = Number(process.argv[3])
const z = Number(process.argv[4])
if (!Number.isInteger(x) || !Number.isInteger(z)) {
  console.error('Usage: node inspect-world-chunk.js <worldDir> <chunkX> <chunkZ>')
  process.exit(1)
}

const rx = Math.floor(x / 32)
const rz = Math.floor(z / 32)
const lx = ((x % 32) + 32) % 32
const lz = ((z % 32) + 32) % 32
const index = lx + lz * 32
const file = path.join(worldDir, 'region', `r.${rx}.${rz}.mca`)

function readPayload(buffer, index) {
  const raw = buffer.readUInt32BE(index * 4)
  const offset = raw >>> 8
  const sectors = raw & 0xff
  if (!raw) return { raw, offset, sectors, payload: null }
  const start = offset * 4096
  const length = buffer.readUInt32BE(start)
  const compression = buffer[start + 4]
  const compressed = buffer.subarray(start + 5, start + 4 + length)
  let payload
  if (compression === 1) payload = zlib.gunzipSync(compressed)
  else if (compression === 2) payload = zlib.inflateSync(compressed)
  else if (compression === 3) payload = compressed
  else throw new Error(`Unsupported compression ${compression}`)
  return { raw, offset, sectors, length, compression, payload }
}

class Reader {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
    this.intTags = []
  }
  u8() { return this.buffer[this.offset++] }
  i32() { const value = this.buffer.readInt32BE(this.offset); this.offset += 4; return value }
  skip(bytes) { this.offset += bytes }
  string() {
    const length = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    const value = this.buffer.toString('utf8', this.offset, this.offset + length)
    this.offset += length
    return value
  }
  root() {
    const type = this.u8()
    const name = this.string()
    this.compound(name || 'root')
  }
  namedPayload(type, parent) {
    const name = this.string()
    this.payload(type, `${parent}.${name}`)
  }
  compound(parent) {
    while (this.offset < this.buffer.length) {
      const type = this.u8()
      if (type === 0) return
      this.namedPayload(type, parent)
    }
  }
  payload(type, name) {
    if (type === 1) return this.skip(1)
    if (type === 2) return this.skip(2)
    if (type === 3) {
      const value = this.i32()
      if (/xPos|zPos|DataVersion|LastUpdate|InhabitedTime|Status|Position|pos/i.test(name)) this.intTags.push({ name, value })
      return
    }
    if (type === 4) return this.skip(8)
    if (type === 5) return this.skip(4)
    if (type === 6) return this.skip(8)
    if (type === 7) return this.skip(this.i32())
    if (type === 8) return this.string()
    if (type === 9) {
      const child = this.u8()
      const length = this.i32()
      for (let i = 0; i < length; i++) this.payload(child, `${name}[]`)
      return
    }
    if (type === 10) return this.compound(name)
    if (type === 11) return this.skip(this.i32() * 4)
    if (type === 12) return this.skip(this.i32() * 8)
    throw new Error(`Unknown NBT tag ${type} at ${name}`)
  }
}

console.log(`Chunk ${x},${z}`)
console.log(`Region file: ${file}`)
console.log(`Slot: ${index} local ${lx},${lz}`)
if (!fs.existsSync(file)) {
  console.log('Missing region file')
  process.exit(0)
}
const buffer = fs.readFileSync(file)
console.log(`File size: ${buffer.length}`)
if (buffer.length < 8192) process.exit(0)
const chunk = readPayload(buffer, index)
console.log(`Header raw=${chunk.raw} offset=${chunk.offset} sectors=${chunk.sectors}`)
if (!chunk.payload) process.exit(0)
console.log(`Length=${chunk.length} compression=${chunk.compression} payload=${chunk.payload.length}`)
const reader = new Reader(chunk.payload)
reader.root()
for (const tag of reader.intTags.slice(0, 80)) console.log(`${tag.name} = ${tag.value}`)
