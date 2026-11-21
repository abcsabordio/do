import type { Repeat } from '../types'

// ---------- Ordering ----------

/**
 * Where a task sits in the list (lower = higher up).
 * Very old tasks have no position yet, so fall back to "newest first",
 * using the same formula as the database migration.
 */
export function sortKey(t: { position?: number | null; created_at: string }): number {
  return t.position ?? -Date.parse(t.created_at) / 1000
}

/** Sort tasks or groups by their manual order. */
export const byPosition = (a: { position?: number | null; created_at: string }, b: typeof a) =>
  sortKey(a) - sortKey(b)

// ---------- Reminder times ----------

/** Move a date forward by one repeat step. */
function step(date: Date, repeat: Repeat): Date {
  const d = new Date(date)
  if (repeat === 'daily') d.setDate(d.getDate() + 1)
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return d
}

/**
 * The next time this reminder goes off. For a repeating reminder whose first
 * time has passed, keep stepping forward until we reach the future.
 */
export function nextReminder(remindAt: string, repeat: Repeat | null, now = new Date()): Date {
  let d = new Date(remindAt)
  if (!repeat) return d
  // Guard against a very old start date: at most ~10 years of steps.
  for (let i = 0; d <= now && i < 4000; i++) d = step(d, repeat)
  return d
}

/**
 * The most recent time this reminder went off (at or before now), or null if
 * it hasn't gone off yet. Used by guest-mode notifications.
 */
export function lastReminder(remindAt: string, repeat: Repeat | null, now = new Date()): Date | null {
  let d = new Date(remindAt)
  if (d > now) return null
  if (!repeat) return d
  for (let i = 0; i < 4000; i++) {
    const next = step(d, repeat)
    if (next > now) break
    d = next
  }
  return d
}

/** The user's time zone, e.g. "Asia/Manila". Saved with reminders. */
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "Today, 9:00 AM", "Tomorrow, 9:00 AM" or "Sat, Nov 22, 9:00 AM". */
export function formatReminder(date: Date, now = new Date()): string {
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)

  if (sameDay(date, now)) return `Today, ${time}`
  if (sameDay(date, tomorrow)) return `Tomorrow, ${time}`
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
  return `${day}, ${time}`
}

/** "Every day", "Every Saturday", "Monthly on the 22nd". */
export function repeatLabel(repeat: Repeat, start?: Date): string {
  if (repeat === 'daily') return 'Every day'
  if (repeat === 'weekly') {
    return start ? `Every ${start.toLocaleDateString(undefined, { weekday: 'long' })}` : 'Every week'
  }
  return start ? `Monthly on the ${ordinal(start.getDate())}` : 'Every month'
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

