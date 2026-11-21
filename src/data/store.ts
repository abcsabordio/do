import { createContext, useContext } from 'react'
import type { NewTask, Task, TaskChanges, TaskGroup } from '../types'

/**
 * Everything the screens need to read and change tasks.
 *
 * There are two versions of this:
 *  - cloudStore: talks to Supabase (signed-in users, synced across devices)
 *  - localStore: keeps data in this browser only (guest mode)
 *
 * The components never care which one they get. Every method throws an
 * Error with a readable message when something goes wrong.
 */
export interface TaskStore {
  kind: 'cloud' | 'local'
  listTasks(groupId: string | null): Promise<Task[]>
  addTask(task: NewTask, groupId: string | null): Promise<Task>
  updateTask(id: string, changes: TaskChanges): Promise<void>
  updateTasks(ids: string[], changes: TaskChanges): Promise<void>
  deleteTask(id: string): Promise<void>
  deleteTasks(ids: string[]): Promise<void>
  listGroups(): Promise<TaskGroup[]>
  // Every group plus all of their tasks, in a single request.
  listGroupsWithTasks(): Promise<{ groups: TaskGroup[]; tasks: Task[] }>
  addGroup(name: string): Promise<TaskGroup>
  deleteGroup(id: string): Promise<void>
}

export const StoreContext = createContext<TaskStore | null>(null)

export function useStore(): TaskStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreContext value={...}>')
  return store
}
