'use strict'
const fs = require('fs')
const path = require('path')

const SCHEMA_VERSION = 1
const TASK_STATUSES = new Set(['available', 'reserved', 'assigned', 'running', 'blocked', 'completed', 'failed', 'cancelled'])
const GOAL_STATUSES = new Set(['planning', 'ready', 'running', 'blocked', 'completed', 'failed', 'cancelled'])

function initialState() { return { schemaVersion: SCHEMA_VERSION, goals: [], tasks: [], reservations: [], inventory: { containers: {}, reservations: {} }, updatedAt: Date.now() } }
function migrate(value = {}) {
  const state = { ...initialState(), ...(value && typeof value === 'object' ? value : {}) }
  state.schemaVersion = SCHEMA_VERSION
  state.goals = Array.isArray(state.goals) ? state.goals.filter(goal => goal?.id && GOAL_STATUSES.has(goal.status)) : []
  state.tasks = Array.isArray(state.tasks) ? state.tasks.filter(task => task?.id && TASK_STATUSES.has(task.status)) : []
  state.reservations = Array.isArray(state.reservations) ? state.reservations.filter(item => item?.id && item.worldId && item.expiresAt) : []
  state.inventory = state.inventory && typeof state.inventory === 'object' ? state.inventory : { containers: {}, reservations: {} }
  state.inventory.containers ||= {}; state.inventory.reservations ||= {}
  return state
}

class TeamStore {
  constructor(file, options = {}) { this.file = file; this.log = options.log || console.warn; this.saveRetries = Math.max(1, Number(options.saveRetries || 5)); this.retryDelayMs = Math.max(0, Number(options.retryDelayMs || 25)); this.state = this.load() }
  load() {
    try {
      const state = migrate(JSON.parse(fs.readFileSync(this.file, 'utf8')))
      // Info: Running werk uit een oude Hub-instance wordt veilig opnieuw beschikbaar gemaakt.
      for (const task of state.tasks) if (['reserved', 'assigned', 'running'].includes(task.status)) Object.assign(task, { status: 'available', assignedBotId: null, assignedInstanceId: null, reservationExpiresAt: null, updatedAt: Date.now() })
      state.reservations = []
      return state
    } catch (error) { if (error.code !== 'ENOENT') this.log(`Team state reset: ${error.message}`); return initialState() }
  }
  save() {
    this.state.updatedAt = Date.now(); fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    for (let attempt=1;attempt<=this.saveRetries;attempt++) {
      try { fs.renameSync(temporary, this.file); return true }
      catch (error) {
        const transient=['EPERM','EBUSY','EACCES'].includes(error.code)
        if (!transient || attempt===this.saveRetries) {
          try { fs.rmSync(temporary, { force:true }) } catch {}
          this.log(`Team state save deferred after ${attempt} attempt(s): ${error.message}`)
          return false
        }
        // Info: Windows, antivirus of een USB-schijf kan de doelnaam heel kort vasthouden; begrensd wachten voorkomt een Hub-crash.
        if (this.retryDelayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,this.retryDelayMs*attempt)
      }
    }
    return false
  }
}
module.exports = { TeamStore, migrate, TASK_STATUSES, GOAL_STATUSES, SCHEMA_VERSION }
