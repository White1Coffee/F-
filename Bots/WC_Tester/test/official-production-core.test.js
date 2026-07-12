const test = require('node:test')
const assert = require('node:assert/strict')
const { SkillRegistry } = require('../../official-bot/src/skills/skillRegistry')
const { registerVerticalSkills, DEFINITIONS } = require('../../official-bot/src/skills/verticalSkills')
const { TaskManager } = require('../../official-bot/src/core/taskManager')
const result = require('../../official-bot/src/skills/skillResult')

test('WC_Tester can load and execute the production skill contract without Minecraft login', async () => {
  const adapters = Object.fromEntries(DEFINITIONS.map(([name]) => [name, async () => result.success({ environment: 'WC_Tester' })]))
  const registry = registerVerticalSkills(new SkillRegistry(), adapters)
  const manager = new TaskManager({ registry, taskTimeoutMs: 1000 })
  const completed = new Promise(resolve => manager.once('complete', resolve))
  manager.enqueue({ name: 'tester-chain', goal: 'collect_wood', source: 'WC_Tester', plan: ['ensureSafety', 'collectWood'] })
  const task = await completed
  assert.equal(task.result.success, true)
  assert.equal(registry.list().length, DEFINITIONS.length)
  await manager.close()
})
