import type { Task, TaskGroup } from '../types'
import type { TaskStore } from './store'

/**
 * Guest mode storage: everything lives in this browser's localStorage.
 * Nothing leaves the device until the guest creates an account
 * (see syncGuestData.ts).
 */

const KEY = 'todo.guest.v1'

interface GuestData {
  tasks: Task[]
  groups: Omit<TaskGroup, 'task_count'>[]
}

export function readGuestData(): GuestData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GuestData>
      // Tasks saved by an older version used `description` instead of `notes`.
      const tasks = (parsed.tasks ?? []).map((t) => {
        const { description, ...rest } = t as Task & { description?: string | null }
        return { ...rest, notes: rest.notes ?? description ?? null }
      })
      return { tasks, groups: parsed.groups ?? [] }
    }
  } catch {
    // Corrupt or blocked storage: start empty rather than crash.
  }
  return { tasks: [], groups: [] }
}

function write(data: GuestData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    throw new Error('Could not save on this device. Your browser storage may be full or blocked.')
  }
}

export function clearGuestData() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

/** How many tasks a guest has stored on this device. */
export function guestTaskCount(): number {
  return readGuestData().tasks.length
}

const newest = (a: { created_at: string }, b: { created_at: string }) =>
  b.created_at.localeCompare(a.created_at)

export const localStore: TaskStore = {
  kind: 'local',

  async listTasks(groupId) {
    return readGuestData()
      .tasks.filter((t) => t.group_id === groupId)
      .sort(newest)
  },

  async addTask(input, groupId) {
    const data = readGuestData()
    const task: Task = {
      id: crypto.randomUUID(),
      title: input.title,
      notes: input.notes ?? null,
      is_done: false,
      group_id: groupId,
      created_at: new Date().toISOString(),
      completed_at: null,
      remind_at: input.remind_at ?? null,
      repeat: input.repeat ?? null,
      tz: input.tz ?? null,
      position: input.position ?? null,
    }
    data.tasks.push(task)
    write(data)
    return task
  },

  async updateTask(id, changes) {
    return localStore.updateTasks([id], changes)
  },

  async updateTasks(ids, changes) {
    const data = readGuestData()
    const targets = new Set(ids)
    data.tasks = data.tasks.map((t) => (targets.has(t.id) ? { ...t, ...changes } : t))
    write(data)
  },

  async deleteTask(id) {
    return localStore.deleteTasks([id])
  },

  async deleteTasks(ids) {
    const data = readGuestData()
    const targets = new Set(ids)
    data.tasks = data.tasks.filter((t) => !targets.has(t.id))
    write(data)
  },

  async listGroups() {
    const data = readGuestData()
    return data.groups
      .map((g) => ({ ...g, task_count: data.tasks.filter((t) => t.group_id === g.id).length }))
      .sort(newest)
  },

  async listGroupsWithTasks() {
    const groups = await localStore.listGroups()
    const ids = new Set(groups.map((g) => g.id))
    return { groups, tasks: readGuestData().tasks.filter((t) => t.group_id && ids.has(t.group_id)) }
  },

  async addGroup(name) {
    const data = readGuestData()
    const group = { id: crypto.randomUUID(), name, created_at: new Date().toISOString() }
    data.groups.push(group)
    write(data)
    return { ...group, task_count: 0 }
  },

  async deleteGroup(id) {
    // Same behaviour as the cloud: deleting a group deletes its tasks.
    const data = readGuestData()
    data.groups = data.groups.filter((g) => g.id !== id)
    data.tasks = data.tasks.filter((t) => t.group_id !== id)
    write(data)
  },
}
