import { supabase } from '../supabase'
import { clearGuestData, readGuestData } from './localStore'

/**
 * Upload everything a guest created on this device into their account,
 * then remove the local copy.
 *
 * Local items already have random UUIDs, so we reuse them as the cloud ids.
 * That makes the upload safe to retry: if it fails halfway (or two tabs run
 * it at once), rows that already made it are skipped instead of duplicated.
 *
 * Returns the number of tasks uploaded.
 */
export async function syncGuestData(): Promise<number> {
  const { tasks, groups } = readGuestData()
  if (tasks.length === 0 && groups.length === 0) return 0

  // Groups first, because tasks point at them.
  if (groups.length > 0) {
    const { error } = await supabase
      .from('task_groups')
      .upsert(groups, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  }

  if (tasks.length > 0) {
    // Send only real columns, so an extra field in old local data can't
    // make the whole upload fail.
    const rows = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes ?? null,
      is_done: t.is_done,
      group_id: t.group_id,
      created_at: t.created_at,
      completed_at: t.completed_at,
      remind_at: t.remind_at ?? null,
      repeat: t.repeat ?? null,
      tz: t.tz ?? (t.remind_at ? Intl.DateTimeFormat().resolvedOptions().timeZone : null),
      position: t.position ?? null,
    }))
    const { error } = await supabase
      .from('tasks')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  }

  clearGuestData()
  return tasks.length
}
