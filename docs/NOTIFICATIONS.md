# Reminder notifications

Reminders reach you even when the app is closed. Every minute, Supabase runs a
small server function (`send-reminders`) that finds due reminders and sends
them to every device where you turned notifications on.

```
pg_cron (every minute) ──► Edge Function send-reminders ──► browser push service ──► your phone / PC
                               │
                               └─ claim_due_reminders(): picks due tasks, moves repeating ones to their next time
```

Guests (no account) only get reminders **while the app is open**, because the
server has no way to reach them. Creating an account fixes that.

## Setup (about 10 minutes)

### 1. Update the database

In Supabase → **SQL Editor → New query**, run these files in order (each once):

1. [`002_task_details.sql`](../supabase/migrations/002_task_details.sql)
2. [`003_push_reminders.sql`](../supabase/migrations/003_push_reminders.sql)
3. [`005_hardening.sql`](../supabase/migrations/005_hardening.sql)

### 2. Create VAPID keys

These identify your app to the browsers' push services.

```powershell
npx web-push generate-vapid-keys
```

Put both keys in `.env.local`:

```
VITE_VAPID_PUBLIC_KEY=BPx...public key...
VAPID_PRIVATE_KEY=...private key...
```

The private key has **no** `VITE_` prefix. Anything starting with `VITE_` can
end up in the website, and the private key must stay secret.

### 3. Run the setup script

Create a personal access token at
[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens), then:

**Command Prompt**

```cmd
set SUPABASE_ACCESS_TOKEN=your-token
npm run push:setup
set SUPABASE_ACCESS_TOKEN=
```

**PowerShell**

```powershell
$env:SUPABASE_ACCESS_TOKEN = "your-token"
npm run push:setup
Remove-Item Env:SUPABASE_ACCESS_TOKEN
```

The script:

1. Creates a random `CRON_SECRET` and asks for a contact email (`VAPID_SUBJECT`),
   both saved in `.env.local`.
2. Stores the VAPID keys, contact and cron secret as Supabase **Edge Function secrets**.
3. Deploys the `send-reminders` function (no Docker needed).
4. Turns on the `pg_cron` and `pg_net` extensions and schedules the job every
   minute. The cron secret is kept in Supabase Vault.
5. Calls the function once. `{"due":0,"sent":0}` means it works.

It's safe to run again; every step updates what's already there. Delete the
token afterwards. Never paste it into chats, code or commits.

> **Manual route:** [`004_reminder_cron.sql`](../supabase/migrations/004_reminder_cron.sql)
> does step 4 by hand, and the comment at the top of
> [`send-reminders/index.ts`](../supabase/functions/send-reminders/index.ts) lists the secrets.

### 4. Try it

1. Restart `npm run dev`, sign in, then gear ⚙ → **Notifications** → allow.
2. Create a task with a reminder 2 minutes from now and close the tab.
3. Within a minute of the reminder time a notification appears. Tapping it opens the app.

Repeating reminders reopen the task each time they go off, so "Wash motorcycle,
every Saturday" is back on your list every Saturday.

## Phones

- **Android (Chrome):** works in the browser and in the installed app.
- **iPhone (iOS 16.4+):** Apple only allows notifications for web apps added to
  the Home Screen: Safari → Share → **Add to Home Screen**, open it from there,
  then turn on Notifications in the gear menu.
- Notifications need **https** (or `localhost`). A phone can't use the dev server
  on your PC over plain `http://192.168…`. Deploy first ([DEPLOYMENT.md](DEPLOYMENT.md)).

## Troubleshooting

Run these in the SQL Editor:

```sql
-- Is the job running? (a row every minute)
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;

-- What did the function answer?  {"due":1,"sent":1} means a notification went out.
select status_code, content from net._http_response order by created desc limit 5;

-- Which reminders are waiting?
select title, next_notify_at, repeat, tz from tasks where next_notify_at is not null order by next_notify_at;

-- Which devices are registered?
select user_id, left(endpoint, 60), created_at from push_subscriptions;
```

| Symptom | Cause |
|---|---|
| `403 Forbidden` | The cron job's secret doesn't match the function's `CRON_SECRET`. Run `npm run push:setup` again. |
| `due: 1, sent: 0` | No device registered for that account. Turn Notifications on again in the gear menu. |
| `500` | See Supabase → **Edge Functions → send-reminders → Logs**. |
| Nothing on iPhone | The app must be opened from the Home Screen icon, not from Safari. |

## How it works (for developers)

| Piece | File |
|---|---|
| Ask permission, subscribe, save device | [`src/lib/push.ts`](../src/lib/push.ts), [`src/lib/useNotifications.ts`](../src/lib/useNotifications.ts) |
| Show the notification, open the app on tap | [`public/sw.js`](../public/sw.js) |
| Guest reminders (every 30 s while open) | [`src/lib/localReminders.ts`](../src/lib/localReminders.ts) |
| Work out `next_notify_at`, store devices | [`003_push_reminders.sql`](../supabase/migrations/003_push_reminders.sql), [`005_hardening.sql`](../supabase/migrations/005_hardening.sql) |
| Send pushes | [`supabase/functions/send-reminders/index.ts`](../supabase/functions/send-reminders/index.ts) |

- Each reminder stores the **time zone** it was set in (`tasks.tz`). Repeats are
  calculated in that zone, so "9 AM every Saturday" stays 9 AM through daylight saving.
- Monthly repeats step from the original date, so the 31st stays the 31st (or the
  last day of shorter months) instead of drifting.
- `claim_due_reminders()` uses `FOR UPDATE SKIP LOCKED`, so two overlapping runs
  never send the same reminder twice.
- Devices that the push service reports as gone (`404`/`410`) are deleted.
  Each account keeps at most 10 devices.
