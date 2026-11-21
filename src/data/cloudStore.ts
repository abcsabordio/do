import { supabase } from '../supabase'
import type { Task, TaskGroup } from '../types'
import type { TaskStore } from './store'

// Supabase returns { data, error }. This turns an error into a thrown Error
// so the store behaves like an ordinary async API.
function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
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
