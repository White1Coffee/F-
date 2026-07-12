const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.resolve(__dirname, '..', '..')
const worldDir = path.resolve(process.argv[2] || path.join(ROOT, 'minecraft-java-server', 'world'))
const apply = process.argv.includes('--apply')
const backupRoot = path.join(ROOT, 'Data', 'backups', 'minecraft-worlds', `region-file-before-repair-${stamp()}`)

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

function stamp() {
  const date = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getDate())}${pad(date.getMonth() + 1)}${date.getFullYear()}`
}

function walk(dir, output = []) {
  if (!fs.existsSync(dir)) return output
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, output)
    else if (entry.isFile() && entry.name.endsWith('.mca')) output.push(full)
  }
  return output
}

function readLocation(buffer, index) {
  const offset = buffer.readUIntBE(index * 4, 3)
  const sectors = buffer[index * 4 + 3]
  return { offset, sectors, raw: buffer.readUInt32BE(index * 4) }
}

function writeLocation(buffer, index, location) {
  buffer.writeUInt32BE(location.raw >>> 0, index * 4)
}

function clearLocation(buffer, index) {
  buffer.writeUInt32BE(0, index * 4)
}

function readTimestamp(buffer, index) {
  return buffer.readUInt32BE(4096 + index * 4)
}

function writeTimestamp(buffer, index, value) {
  buffer.writeUInt32BE(value >>> 0, 4096 + index * 4)
}

function regionCoords(file) {
  const match = path.basename(file).match(/^r\.(-?\d+)\.(-?\d+)\.mca$/)
  if (!match) return null
  return { rx: Number(match[1]), rz: Number(match[2]) }
}

function localIndex(localX, localZ) {
  return localX + localZ * 32
}

function mod32(value) {
  return ((value % 32) + 32) % 32
}

function globalForIndex(region, index) {
  const localX = index % 32
  const localZ = Math.floor(index / 32)
  return { x: region.rx * 32 + localX, z: region.rz * 32 + localZ }
}

function expectedIndexFor(region, x, z) {
  if (Math.floor(x / 32) !== region.rx || Math.floor(z / 32) !== region.rz) return -1
  return localIndex(mod32(x), mod32(z))
}

function readChunkPayload(fileBuffer, location) {
  const start = location.offset * 4096
  if (!location.offset || !location.sectors || start + 5 > fileBuffer.length) return null
  const length = fileBuffer.readUInt32BE(start)
  if (length <= 1 || start + 4 + length > fileBuffer.length) return null
  const compression = fileBuffer[start + 4]
  const payload = fileBuffer.subarray(start + 5, start + 4 + length)
  if (compression === 1) return zlib.gunzipSync(payload)
  if (compression === 2) return zlib.inflateSync(payload)
  if (compression === 3) return payload
  throw new Error(`Unsupported chunk compression ${compression}`)
}

class NbtReader {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
    this.coords = {}
  }

  u8() { return this.buffer[this.offset++] }
  i16() { const value = this.buffer.readInt16BE(this.offset); this.offset += 2; return value }
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
    if (type !== TAG_COMPOUND) throw new Error(`NBT root is not a compound: ${type}`)
    this.string()
    this.compound('')
    return Number.isInteger(this.coords.xPos) && Number.isInteger(this.coords.zPos) ? this.coords : null
  }

  namedPayload(type, pathName) {
    const name = this.string()
    this.payload(type, pathName ? `${pathName}.${name}` : name)
  }

  compound(pathName) {
    while (this.offset < this.buffer.length) {
      const type = this.u8()
      if (type === TAG_END) return
      this.namedPayload(type, pathName)
    }
  }

  payload(type, pathName) {
    switch (type) {
      case TAG_BYTE: this.skip(1); return
      case TAG_SHORT: this.skip(2); return
      case TAG_INT: {
        const value = this.i32()
        if (pathName === 'xPos' || pathName.endsWith('.xPos')) this.coords.xPos = value
        if (pathName === 'zPos' || pathName.endsWith('.zPos')) this.coords.zPos = value
        return
      }
      case TAG_LONG: this.skip(8); return
      case TAG_FLOAT: this.skip(4); return
      case TAG_DOUBLE: this.skip(8); return
      case TAG_BYTE_ARRAY: this.skip(this.i32()); return
      case TAG_STRING: this.string(); return
      case TAG_LIST: {
        const childType = this.u8()
        const length = this.i32()
        for (let i = 0; i < length; i++) this.payload(childType, `${pathName}[]`)
        return
      }
      case TAG_COMPOUND: this.compound(pathName); return
      case TAG_INT_ARRAY: this.skip(this.i32() * 4); return
      case TAG_LONG_ARRAY: this.skip(this.i32() * 8); return
      default: throw new Error(`Unknown NBT tag ${type}`)
    }
  }
}

function chunkCoords(fileBuffer, location) {
  const payload = readChunkPayload(fileBuffer, location)
  if (!payload) return null
  return new NbtReader(payload).root()
}

function backupFile(file) {
  const relative = path.relative(worldDir, file)
  const target = path.join(backupRoot, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(file, target)
  return target
}

function repairFile(file) {
  const region = regionCoords(file)
  if (!region) return { file, scanned: 0, fixed: 0, conflicts: 0, errors: 0, actions: [] }
  const buffer = fs.readFileSync(file)
  if (buffer.length < 8192) {
    return {
      file,
      scanned: 0,
      fixed: 0,
      conflicts: 0,
      errors: 1,
      actions: [`ERROR ${path.basename(file)} is too small to be a valid region file (${buffer.length} bytes)`]
    }
  }
  const entries = []
  const byStored = new Map()
  const actions = []
  let errors = 0

  for (let index = 0; index < 1024; index++) {
    const location = readLocation(buffer, index)
    if (!location.raw) continue
    try {
      const coords = chunkCoords(buffer, location)
      if (!coords) continue
      const expected = globalForIndex(region, index)
      const entry = { index, location, timestamp: readTimestamp(buffer, index), expected, stored: { x: coords.xPos, z: coords.zPos } }
      entries.push(entry)
      byStored.set(`${entry.stored.x},${entry.stored.z}`, entry)
    } catch (err) {
      errors++
      actions.push(`ERROR ${path.basename(file)} slot ${index}: ${err.message}`)
    }
  }

  let fixed = 0
  let conflicts = 0
  let touched = false

  for (const entry of entries) {
    if (entry.expected.x === entry.stored.x && entry.expected.z === entry.stored.z) continue
    const targetIndex = expectedIndexFor(region, entry.stored.x, entry.stored.z)
    if (targetIndex < 0) {
      conflicts++
      actions.push(`CONFLICT ${path.basename(file)} slot ${entry.index} stores ${entry.stored.x},${entry.stored.z}, which belongs to another region file`)
      continue
    }
    const targetLocation = readLocation(buffer, targetIndex)
    const existingCorrect = byStored.get(`${entry.stored.x},${entry.stored.z}`)

    if (!targetLocation.raw) {
      actions.push(`MOVE ${path.basename(file)} slot ${entry.index} (${entry.expected.x},${entry.expected.z}) -> slot ${targetIndex} (${entry.stored.x},${entry.stored.z})`)
      if (apply) {
        writeLocation(buffer, targetIndex, entry.location)
        writeTimestamp(buffer, targetIndex, entry.timestamp)
        clearLocation(buffer, entry.index)
        writeTimestamp(buffer, entry.index, 0)
      }
      fixed++
      touched = true
      continue
    }

    if (existingCorrect && existingCorrect.index === targetIndex) {
      actions.push(`CLEAR DUPLICATE ${path.basename(file)} slot ${entry.index} points to ${entry.stored.x},${entry.stored.z}, already present at slot ${targetIndex}`)
      if (apply) {
        clearLocation(buffer, entry.index)
        writeTimestamp(buffer, entry.index, 0)
      }
      fixed++
      touched = true
      continue
    }

    conflicts++
    actions.push(`CONFLICT ${path.basename(file)} slot ${entry.index} stores ${entry.stored.x},${entry.stored.z}, but target slot ${targetIndex} is occupied`)
  }

  let backup = ''
  if (apply && touched) {
    backup = backupFile(file)
    fs.writeFileSync(file, buffer)
  }
  return { file, scanned: entries.length, fixed, conflicts, errors, backup, actions }
}

const files = [
  ...walk(path.join(worldDir, 'region')),
  ...walk(path.join(worldDir, 'entities')),
  ...walk(path.join(worldDir, 'poi'))
]

if (!files.length) {
  console.error(`No .mca files found in ${worldDir}`)
  process.exit(1)
}

const results = files.map(repairFile)
let fixed = 0
let conflicts = 0
let errors = 0
for (const result of results) {
  fixed += result.fixed
  conflicts += result.conflicts
  errors += result.errors
  for (const action of result.actions) console.log(action)
  if (result.backup) console.log(`BACKUP ${result.backup}`)
}

console.log('')
console.log(`${apply ? 'Applied' : 'Dry run'} region repair`)
console.log(`World: ${worldDir}`)
console.log(`Files scanned: ${files.length}`)
console.log(`Misplaced chunks fixed: ${fixed}`)
console.log(`Conflicts left unchanged: ${conflicts}`)
console.log(`Read errors: ${errors}`)
if (!apply) console.log('Run again with --apply to write the safe header fixes.')
