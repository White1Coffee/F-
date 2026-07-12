const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { mergeKnowledgeDocuments, mergeKnowledgeFolders, mergeKnowledgeFoldersMany } = require('../src/knowledge-merge')

test('knowledge merge adds counters, combines lists and keeps newest configuration', () => {
  const merged = mergeKnowledgeDocuments(
    {
      updatedAt: '2026-01-01T00:00:00Z',
      rules: { range: 8 },
      stats: { mined: { iron: 2 } },
      categories: { food: ['apple'] },
      learning: { blocks: { iron: { score: 4, attempts: 2, notes: [{ at: '2026-01-01T00:00:00Z', note: 'old' }] } } }
    },
    {
      updatedAt: '2026-02-01T00:00:00Z',
      rules: { range: 12 },
      stats: { mined: { iron: 3 } },
      categories: { food: ['bread'] },
      learning: { blocks: { iron: { score: 5, attempts: 3, notes: [{ at: '2026-02-01T00:00:00Z', note: 'new' }] } } }
    }
  )

  assert.deepEqual(merged.rules, { range: 12 })
  assert.deepEqual(merged.categories, { food: ['apple', 'bread'] })
  assert.equal(merged.stats.mined.iron, 5)
  assert.equal(merged.learning.blocks.iron.score, 9)
  assert.equal(merged.learning.blocks.iron.attempts, 5)
  assert.deepEqual(merged.learning.blocks.iron.notes.map(note => note.note), ['new', 'old'])
})

test('folder merge writes a new directory without modifying sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-merge-'))
  const left = path.join(root, 'left')
  const right = path.join(root, 'right')
  const output = path.join(root, 'merged')
  fs.mkdirSync(left)
  fs.mkdirSync(right)
  fs.writeFileSync(path.join(left, 'items.json'), JSON.stringify({ stats: { pickedUp: { apple: 2 } } }))
  fs.writeFileSync(path.join(right, 'items.json'), JSON.stringify({ stats: { pickedUp: { apple: 3 } } }))

  mergeKnowledgeFolders(left, right, output)

  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'items.json'))).stats.pickedUp.apple, 5)
  assert.equal(JSON.parse(fs.readFileSync(path.join(left, 'items.json'))).stats.pickedUp.apple, 2)
  assert.equal(JSON.parse(fs.readFileSync(path.join(right, 'items.json'))).stats.pickedUp.apple, 3)
})

test('folder merge refuses to write inside a source directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-merge-safe-'))
  const left = path.join(root, 'left')
  const right = path.join(root, 'right')
  fs.mkdirSync(left)
  fs.mkdirSync(right)
  assert.throws(
    () => mergeKnowledgeFolders(left, right, path.join(left, 'merged')),
    /outside both source directories/
  )
})

test('multi-folder merge combines between two and five bots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-merge-many-'))
  const sources = ['one', 'two', 'three'].map(name => path.join(root, name))
  const output = path.join(root, 'merged')
  try {
    for (const [index, source] of sources.entries()) {
      fs.mkdirSync(source)
      fs.writeFileSync(path.join(source, 'mining.json'), JSON.stringify({ stats: { mined: { iron: index + 1 } } }))
    }
    mergeKnowledgeFoldersMany(sources, output)
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'mining.json'))).stats.mined.iron, 6)
    assert.throws(() => mergeKnowledgeFoldersMany([sources[0]], path.join(root, 'too-few')), /between 2 and 5/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
