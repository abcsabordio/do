import { readGuestData } from '../data/localStore'
import { localNotifyOn } from './push'
import { lastReminder } from './reminders'

/**
 * Guest-mode reminders. Guests have no account, so the server can't send
 * them anything; instead, while the app is open, we check every 30 seconds
 * and show a notification for any reminder that has come due.
 */

const FIRED_KEY = 'todo.localFired' // task id → time of the occurrence we last showed
const CHECK_EVERY_MS = 30_000
const MAX_LATE_MS = 12 * 60 * 60 * 1000 // don't show reminders more than 12 h late

function readFired(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

async function check() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !localNotifyOn()) return

  const now = new Date()
  const fired = readFired()
  const reg = await navigator.serviceWorker.ready

  for (const t of readGuestData().tasks) {
    if (!t.remind_at || (t.is_done && !t.repeat)) continue
    const due = lastReminder(t.remind_at, t.repeat, now)
    if (!due || now.getTime() - due.getTime() > MAX_LATE_MS) continue
    if (fired[t.id] && new Date(fired[t.id]) >= due) continue // already shown

    fired[t.id] = due.toISOString()
    await reg.showNotification(t.title, { body: t.notes || 'Reminder', tag: t.id, icon: '/do-icon-192.png' })
  }

  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired))
  } catch {
    // ignore
  }
}

/** Start checking. Returns a function that stops it. */
export function startLocalReminders(): () => void {
  if (!('serviceWorker' in navigator)) return () => {}
  void check()
  const id = window.setInterval(() => void check(), CHECK_EVERY_MS)
  return () => window.clearInterval(id)
}
