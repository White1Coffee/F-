const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { BoundedHistoryStore, summarizeReconnects } = require('../src/dashboard/historyStore')

test('bounded history persists only the newest five records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-history-'))
  const file = path.join(root, 'build-history.json')
  try {
    const store = new BoundedHistoryStore(file, 5)
    for (let index = 1; index <= 7; index++) store.add({ id:`build-${index}`,createdAt:index })
    const restored = new BoundedHistoryStore(file, 5).list()
    assert.deepEqual(restored.map(item => item.id), ['build-7','build-6','build-5','build-4','build-3'])
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schemaVersion, 1)
    assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false)
  } finally {
    fs.rmSync(root, { recursive:true,force:true })
  }
})

test('reconnect summary separates bots and servers into seven-day graphs', () => {
  const now = Date.parse('2026-07-21T12:00:00Z')
  const summary = summarizeReconnects([
    { timestamp:now,botId:'a',botName:'Bot A',serverId:'one:25565',serverName:'one:25565' },
    { timestamp:now - 86400000,botId:'a',botName:'Bot A',serverId:'one:25565',serverName:'one:25565' },
    { timestamp:now,botId:'b',botName:'Bot B',serverId:'two:25565',serverName:'two:25565' }
  ], now)
  assert.equal(summary.bots.find(item => item.id === 'a').total, 2)
  assert.equal(summary.servers.find(item => item.id === 'one:25565').total, 2)
  assert.equal(summary.bots[0].series.length, 7)
})
