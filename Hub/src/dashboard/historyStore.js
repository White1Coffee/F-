const fs = require('fs')
const path = require('path')

// Info: Kleine runtime-histories worden atomisch opgeslagen, zodat een Hub-stop nooit een half JSON-bestand achterlaat.
class BoundedHistoryStore {
  constructor(file, limit = 100) {
    this.file = file
    this.limit = Math.max(1, Number(limit) || 100)
    this.items = this.load()
  }

  load() {
    for (const candidate of [this.file, `${this.file}.bak`]) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8').replace(/^\uFEFF/, ''))
        return Array.isArray(parsed?.items) ? parsed.items.slice(0, this.limit) : []
      } catch {}
    }
    return []
  }

  list() {
    return this.items.map(item => structuredClone(item))
  }

  add(item) {
    this.items = [structuredClone(item), ...this.items.filter(value => value.id !== item.id)].slice(0, this.limit)
    this.save()
    return item
  }

  replace(items) {
    this.items = (Array.isArray(items) ? items : []).slice(0, this.limit).map(item => structuredClone(item))
    this.save()
  }

  remove(id) {
    const previous = this.items.length
    this.items = this.items.filter(item => item.id !== id)
    if (this.items.length !== previous) this.save()
    return this.items.length !== previous
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    const backup = `${this.file}.bak`
    fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, items: this.items }, null, 2)}\n`, 'utf8')
    try {
      if (fs.existsSync(this.file)) {
        fs.rmSync(backup, { force:true })
        fs.renameSync(this.file, backup)
      }
      fs.renameSync(temporary, this.file)
      fs.rmSync(backup, { force:true })
    } catch (error) {
      if (!fs.existsSync(this.file) && fs.existsSync(backup)) fs.renameSync(backup, this.file)
      try { fs.rmSync(temporary, { force:true }) } catch {}
      throw error
    }
  }
}

function summarizeReconnects(events, now = Date.now(), days = 7) {
  const dayMs = 86400000
  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(now - (days - index - 1) * dayMs)
    return date.toISOString().slice(0, 10)
  })
  const summarize = (keyName, labelName) => {
    const groups = new Map()
    for (const event of events) {
      const timestamp = Number(event?.timestamp)
      if (!Number.isFinite(timestamp)) continue
      const key = String(event?.[keyName] || 'unknown')
      const label = String(event?.[labelName] || key)
      if (!groups.has(key)) groups.set(key, { id: key, label, total: 0, counts: Object.fromEntries(buckets.map(bucket => [bucket, 0])) })
      const bucket = new Date(timestamp).toISOString().slice(0, 10)
      const group = groups.get(key)
      if (bucket in group.counts) {
        group.counts[bucket]++
        group.total++
      }
    }
    return [...groups.values()].map(group => ({ ...group, series: buckets.map(label => ({ label, count: group.counts[label] })) })).map(({ counts, ...group }) => group).sort((left, right) => right.total - left.total || left.label.localeCompare(right.label))
  }
  return { days, buckets, bots: summarize('botId', 'botName'), servers: summarize('serverId', 'serverName') }
}

module.exports = { BoundedHistoryStore, summarizeReconnects }
