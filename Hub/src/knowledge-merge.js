const fs = require('fs')
const path = require('path')
// Keep the Hub on the production bot's versioned, schema-aware merge engine.
// The public API stays identical for existing Hub routes.
const productionMerge = require('../../Bots/official-bot/src/knowledge-merge')

const COUNT_KEYS = new Set([
  'attempts', 'successes', 'failures', 'uses', 'sightings', 'mined',
  'blocksSeen', 'blocksMined', 'failedMines', 'encounters', 'deaths',
  'finishedFights', 'failedFights', 'blockedHits', 'pickedUp', 'kept',
  'stuckEvents', 'unstuckAttempts', 'holesEscaped', 'watchdogResets',
  'watchdogPathResets', 'watchdogAutonomyRestarts', 'watchdogWakes',
  'actionRecoveryRequests', 'pillarsBuilt'
])

const CONFIG_KEYS = new Set([
  'rules', 'strategies', 'resources', 'foodRules', 'survivalCrafts',
  'endgamePlans', 'clearableBlocks', 'unstuckClearableBlocks',
  'avoidFloorBlocks', 'buildingBlocks'
])

function timestampValue(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function newest(left, right) {
  return timestampValue(right?.updatedAt || right?.lastUsedAt || right?.discoveredAt || right?.at) >=
    timestampValue(left?.updatedAt || left?.lastUsedAt || left?.discoveredAt || left?.at)
    ? right
    : left
}

function stableKey(value) {
  if (value && typeof value === 'object') {
    if (value.at || value.note) return `${value.at || ''}:${value.note || ''}`
    if (value.item) return `item:${value.item}`
    if (value.name) return `name:${value.name}`
  }
  return JSON.stringify(value)
}

function mergeArrays(left = [], right = [], keyPath = []) {
  const key = keyPath.at(-1)
  const merged = new Map()
  for (const value of [...left, ...right]) merged.set(stableKey(value), value)
  const values = [...merged.values()]
  if (key === 'notes') {
    return values
      .sort((a, b) => timestampValue(b?.at) - timestampValue(a?.at))
      .slice(0, 50)
  }
  return values
}

function shouldAddNumbers(keyPath) {
  return keyPath.includes('stats') ||
    keyPath.includes('learning') ||
    keyPath.includes('oreHeatmap') ||
    COUNT_KEYS.has(keyPath.at(-1))
}

function mergeValues(left, right, keyPath = []) {
  if (left === undefined) return structuredClone(right)
  if (right === undefined) return structuredClone(left)

  const key = keyPath.at(-1)
  if (CONFIG_KEYS.has(key)) return structuredClone(newest({ updatedAt: keyPath.rootLeftUpdatedAt, value: left }, { updatedAt: keyPath.rootRightUpdatedAt, value: right }).value)
  if (Array.isArray(left) && Array.isArray(right)) return mergeArrays(left, right, keyPath)
  if (typeof left === 'number' && typeof right === 'number') {
    if (key === 'version') return Math.max(left, right)
    if (key === 'score') return Math.max(-100, Math.min(100, left + right))
    return shouldAddNumbers(keyPath) ? left + right : right
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const result = {}
    for (const childKey of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const childPath = [...keyPath, childKey]
      childPath.rootLeftUpdatedAt = keyPath.rootLeftUpdatedAt
      childPath.rootRightUpdatedAt = keyPath.rootRightUpdatedAt
      result[childKey] = mergeValues(left[childKey], right[childKey], childPath)
    }
    for (const dateKey of ['updatedAt', 'lastUsedAt', 'discoveredAt', 'at']) {
      if (left[dateKey] || right[dateKey]) result[dateKey] = newest(left, right)?.[dateKey] || right[dateKey] || left[dateKey]
    }
    return result
  }
  return structuredClone(newest(
    { updatedAt: keyPath.rootLeftUpdatedAt, value: left },
    { updatedAt: keyPath.rootRightUpdatedAt, value: right }
  ).value)
}

function mergeKnowledgeDocuments(left, right) {
  const keyPath = []
  keyPath.rootLeftUpdatedAt = left?.updatedAt
  keyPath.rootRightUpdatedAt = right?.updatedAt
  const merged = mergeValues(left || {}, right || {}, keyPath)
  merged.updatedAt = new Date().toISOString()
  return merged
}

function jsonFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function mergeKnowledgeFolders(leftDirectory, rightDirectory, outputDirectory) {
  const left = path.resolve(leftDirectory)
  const right = path.resolve(rightDirectory)
  const output = path.resolve(outputDirectory)
  const inside = (parent, candidate) => candidate === parent || candidate.startsWith(`${parent}${path.sep}`)
  if (inside(left, output) || inside(right, output)) throw new Error('Output directory must be outside both source directories.')
  if (!fs.statSync(left).isDirectory() || !fs.statSync(right).isDirectory()) throw new Error('Both source paths must be directories.')
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Output directory must not already contain files.')

  fs.mkdirSync(output, { recursive: true })
  const files = [...new Set([...jsonFiles(left), ...jsonFiles(right)])].sort()
  const results = []
  for (const name of files) {
    const leftFile = path.join(left, name)
    const rightFile = path.join(right, name)
    const outputFile = path.join(output, name)
    const leftData = fs.existsSync(leftFile) ? readJson(leftFile) : {}
    const rightData = fs.existsSync(rightFile) ? readJson(rightFile) : {}
    const merged = mergeKnowledgeDocuments(leftData, rightData)
    fs.writeFileSync(outputFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    results.push({ name, outputFile })
  }
  return results
}

function mergeKnowledgeFoldersMany(sourceDirectories, outputDirectory) {
  const sources = [...new Set((sourceDirectories || []).map(directory => path.resolve(directory)))]
  if (sources.length < 2) throw new Error('Choose at least 2 knowledge directories.')
  for (const source of sources) {
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error(`Knowledge directory does not exist: ${source}`)
  }

  const output = path.resolve(outputDirectory)
  const inside = (parent, candidate) => candidate === parent || candidate.startsWith(`${parent}${path.sep}`)
  if (sources.some(source => inside(source, output))) throw new Error('Output directory must be outside all source directories.')
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Output directory must not already contain files.')

  fs.mkdirSync(output, { recursive: true })
  const files = [...new Set(sources.flatMap(jsonFiles))].sort()
  const results = []
  for (const name of files) {
    const documents = sources
      .map(source => path.join(source, name))
      .filter(fs.existsSync)
      .map(readJson)
    const merged = documents.reduce((combined, document) => mergeKnowledgeDocuments(combined, document), {})
    const outputFile = path.join(output, name)
    fs.writeFileSync(outputFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    results.push({ name, outputFile })
  }
  return results
}

module.exports = productionMerge
