const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const newKnowledgeDir = path.resolve(process.argv[2] || path.join(ROOT, 'new knowledge'))
const botsRoot = path.join(ROOT, 'Bots')
const mergeEngine = ['bot1', 'bot2', 'WC_Tester', 'official-bot']
  .map(name => path.join(botsRoot, name, 'src', 'knowledge-merge.js'))
  .find(file => fs.existsSync(file))
if (!mergeEngine) throw new Error('Could not find a bot knowledge merge engine.')
const { mergeKnowledgeFolders } = require(mergeEngine)

const knowledgeFiles = ['combat.json', 'crafting.json', 'items.json', 'mining.json', 'movement.json']

function stamp() {
  const date = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getDate())}${pad(date.getMonth() + 1)}${date.getFullYear()}`
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function ensureValidSource() {
  if (!fs.existsSync(newKnowledgeDir) || !fs.statSync(newKnowledgeDir).isDirectory()) {
    throw new Error(`New knowledge folder not found: ${newKnowledgeDir}`)
  }
  for (const name of knowledgeFiles) {
    const file = path.join(newKnowledgeDir, name)
    if (!fs.existsSync(file)) throw new Error(`Missing source file: ${file}`)
    readJson(file)
  }
}

function botFolders() {
  return fs.readdirSync(botsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(botsRoot, entry.name))
    .filter(folder => fs.existsSync(path.join(folder, 'knowledge')))
    .filter(folder => fs.existsSync(path.join(folder, 'bot.js')) || fs.existsSync(path.join(folder, 'src')))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }))
}

function copyDirectory(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: true })
}

function replaceDirectory(source, target) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: true })
}

function summarizeKnowledge(directory) {
  const summary = {}
  for (const name of knowledgeFiles) {
    const file = path.join(directory, name)
    if (!fs.existsSync(file)) continue
    const data = readJson(file)
    summary[name] = {
      bytes: fs.statSync(file).size,
      updatedAt: data.updatedAt || '',
      topKeys: Object.keys(data).length
    }
  }
  return summary
}

function main() {
  ensureValidSource()
  const bots = botFolders()
  if (!bots.length) throw new Error('No bot knowledge folders found.')

  const runStamp = stamp()
  const runRoot = path.join(ROOT, 'Data', 'knowledge', 'merge-runs', `new-knowledge-${runStamp}`)
  fs.mkdirSync(runRoot, { recursive: true })
  copyDirectory(newKnowledgeDir, path.join(runRoot, 'source'))

  const results = []
  for (const botFolder of bots) {
    const botName = path.basename(botFolder)
    const knowledgeDir = path.join(botFolder, 'knowledge')
    const backupDir = path.join(botFolder, 'knowledge-backups', `before-new-knowledge-${runStamp}`)
    const outputDir = path.join(runRoot, botName)

    copyDirectory(knowledgeDir, backupDir)
    mergeKnowledgeFolders(knowledgeDir, newKnowledgeDir, outputDir)
    replaceDirectory(outputDir, knowledgeDir)

    results.push({
      bot: botName,
      backup: backupDir,
      knowledge: knowledgeDir,
      files: fs.readdirSync(knowledgeDir).filter(name => name.endsWith('.json')).sort(),
      summary: summarizeKnowledge(knowledgeDir)
    })
  }

  const manifest = {
    at: runStamp,
    source: newKnowledgeDir,
    runRoot,
    bots: results
  }
  fs.writeFileSync(path.join(runRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log(`Merged ${knowledgeFiles.length} new knowledge files into ${results.length} bots.`)
  console.log(`Run folder: ${runRoot}`)
  for (const result of results) {
    console.log(`${result.bot}: backup=${result.backup}`)
  }
}

main()
