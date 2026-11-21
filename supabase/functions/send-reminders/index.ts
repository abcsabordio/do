// Supabase Edge Function: sends push notifications for reminders that are due.
// Called once a minute by pg_cron (see supabase/migrations/004_reminder_cron.sql).
//
// Secrets it needs (set with `npx supabase secrets set ...`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@gmail.com)
//   CRON_SECRET (any long random string; the cron job sends it to prove it's allowed)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
)

interface DueReminder {
  task_id: string
  user_id: string
  title: string
  notes: string | null
}

interface Subscription {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

// Compares in constant time, so response timing can't leak the secret
// one character at a time.
function sameSecret(given: string | null): boolean {
  if (!given || CRON_SECRET.length < 32) return false // unset/short secret: refuse everyone
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(CRON_SECRET)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]
  return diff === 0
}

// Push services reject payloads over ~4 KB, and a notification only shows a
// couple of lines anyway.
const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text)

Deno.serve(async (req) => {
  if (req.method !== 'POST' || !sameSecret(req.headers.get('x-cron-secret'))) {
    return json({ error: 'Forbidden' }, 403)
  }

  // Grab everything that's due (this also moves repeating reminders on).
  const { data: due, error } = await supabase.rpc('claim_due_reminders')
  if (error) {
    console.error('claim_due_reminders failed', error)
    return json({ error: 'Could not load reminders' }, 500) // details go to the logs, not the caller
  }
  const reminders = (due ?? []) as DueReminder[]
  if (reminders.length === 0) return json({ due: 0, sent: 0 })

  const userIds = [...new Set(reminders.map((r) => r.user_id))]
  const { data: subs, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds)
  if (subsError) {
    console.error('Loading push subscriptions failed', subsError)
    return json({ error: 'Could not load devices' }, 500)
  }

  let sent = 0
  const expired: string[] = []

  await Promise.all(
    reminders.flatMap((r) =>
      ((subs ?? []) as Subscription[])
        .filter((s) => s.user_id === r.user_id)
        .map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({
                title: cut(r.title, 120),
                body: cut(r.notes || 'Reminder', 300),
                tag: r.task_id, // a newer reminder for the same task replaces the old one
                url: '/',
              }),
              { TTL: 60 * 60 } // give up after an hour if the device stays offline
            )
            sent++
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode
            // 404/410: the browser unsubscribed or the app was uninstalled.
            if (status === 404 || status === 410) expired.push(s.id)
            else console.error('Push failed', status, err)
          }
        })
    )
  )

  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired)
  }

  return json({ due: reminders.length, sent, removed: expired.length })
})
