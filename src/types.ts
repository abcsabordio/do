export type Repeat = 'daily' | 'weekly' | 'monthly'

export interface Task {
  id: string
  title: string
  notes: string | null
  is_done: boolean
  group_id: string | null
  created_at: string
  completed_at: string | null
  // When to remind. For repeating tasks this is the first occurrence.
  remind_at: string | null
  repeat: Repeat | null
  // Time zone the reminder was set in, so repeats keep the same local time.
  tz?: string | null
  // Manual sort order: lower = higher in the list. Null on very old rows.
  position: number | null
}

export interface TaskGroup {
  id: string
  name: string
  created_at: string
  // Manual sort order: lower = higher in the list. Null on old rows.
  position?: number | null
  // How many tasks are in the group. Filled in by the store when listing.
  task_count: number
}

// Fields you can set when creating a task.
export type NewTask = Pick<Task, 'title'> &
  Partial<Pick<Task, 'notes' | 'remind_at' | 'repeat' | 'tz' | 'position'>>

export type TaskChanges = Partial<
  Pick<Task, 'title' | 'notes' | 'is_done' | 'completed_at' | 'remind_at' | 'repeat' | 'tz' | 'position'>
>
