import { supabase } from '../supabase'
import { LIMITS } from '../lib/limits'
import type { Task, TaskGroup } from '../types'
import type { TaskStore } from './store'

interface DbError {
  message: string
  code?: string
}

// Database rules (005_hardening.sql) → messages a person can act on.
const CHECK_MESSAGES: Record<string, string> = {
  tasks_title_length: `Task names can be 1 to ${LIMITS.taskTitle} characters.`,
  tasks_notes_length: `Descriptions can be up to ${LIMITS.taskNotes} characters.`,
  task_groups_name_length: `Group names can be 1 to ${LIMITS.groupName} characters.`,
  tasks_remind_range: 'Pick a reminder date between 2000 and 2200.',
}

function friendlyDbError(error: DbError): string {
  if (error.code === '23514') {
    const rule = Object.keys(CHECK_MESSAGES).find((name) => error.message.includes(name))
    return rule ? CHECK_MESSAGES[rule] : 'That value isn’t allowed.'
  }
  if (error.code === 'P0001') return error.message // our own limits, already readable
  if (error.code === '42501') return "You don't have permission to change that. Try signing in again."
  if (/failed to fetch|network/i.test(error.message)) return "Can't reach the server. Check your connection."
  return error.message
}

// Supabase returns { data, error }. This turns an error into a thrown Error
// so the store behaves like an ordinary async API.
function check<T>(result: { data: T; error: DbError | null }): T {
  if (result.error) throw new Error(friendlyDbError(result.error))
  return result.data
}

type GroupRow = Omit<TaskGroup, 'task_count'> & { tasks?: { count: number }[] }

function toGroup(row: GroupRow): TaskGroup {
  const { tasks, ...rest } = row
  return { ...rest, task_count: tasks?.[0]?.count ?? 0 }
}

export const cloudStore: TaskStore = {
  kind: 'cloud',

  async listTasks(groupId) {
    const base = supabase.from('tasks').select('*').order('created_at', { ascending: false })
    const query = groupId ? base.eq('group_id', groupId) : base.is('group_id', null)
    return check(await query) as Task[]
  },

  async addTask(task, groupId) {
    const result = await supabase
      .from('tasks')
      .insert({ ...task, group_id: groupId })
      .select()
      .single()
    return check(result) as Task
  },

  async updateTask(id, changes) {
    check(await supabase.from('tasks').update(changes).eq('id', id))
  },

  async updateTasks(ids, changes) {
    check(await supabase.from('tasks').update(changes).in('id', ids))
  },

  async deleteTask(id) {
    check(await supabase.from('tasks').delete().eq('id', id))
  },

  async deleteTasks(ids) {
    check(await supabase.from('tasks').delete().in('id', ids))
  },

  async listGroups() {
    const result = await supabase
      .from('task_groups')
      .select('*, tasks(count)')
      .order('created_at', { ascending: false })
    return (check(result) as GroupRow[]).map(toGroup)
  },

  async listGroupsWithTasks() {
    // One round trip: Supabase joins each group's tasks into the response.
    const result = await supabase
      .from('task_groups')
      .select('*, tasks(*)')
      .order('created_at', { ascending: false })
    const rows = check(result) as (Omit<TaskGroup, 'task_count'> & { tasks: Task[] })[]
    return {
      groups: rows.map(({ tasks, ...g }) => ({ ...g, task_count: tasks.length })),
      tasks: rows.flatMap((r) => r.tasks),
    }
  },

  async addGroup(name) {
    const result = await supabase
      .from('task_groups')
      .insert({ name })
      .select('*, tasks(count)')
      .single()
    return toGroup(check(result) as GroupRow)
  },

  async deleteGroup(id) {
    check(await supabase.from('task_groups').delete().eq('id', id))
  },
}
