# Setting up reminder notifications

Reminders reach you even when the app is closed. Every minute, Supabase runs a
small server function (`send-reminders`) that finds due reminders and sends
them to every device where you turned notifications on.

```
pg_cron (every minute) ──► Edge Function send-reminders ──► browser push service ──► your phone / PC
                               │
                               └─ claim_due_reminders(): picks due tasks, moves repeating ones to next time
```

Do the steps in order. Run all commands in the VS Code terminal from the project folder.

## 1. Update the database

In Supabase → **SQL Editor → New query**, paste and **Run**
[`supabase/migrations/003_push_reminders.sql`](supabase/migrations/003_push_reminders.sql).
(`002_task_details.sql` must have been run before this.)

## 2. Create your VAPID keys

These identify your app to the browsers' push services.

```powershell
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**. Keep this window open for steps 3 and 4.

Add the **public** key to `.env.local`, then restart `npm run dev`:

```
VITE_VAPID_PUBLIC_KEY=BPx...your public key...
```

> The private key is a secret. Never put it in `.env.local`, in the code, or anywhere public.

## 3. Make a cron secret

A random password that proves the minute-by-minute job is allowed to call the function:

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Copy the result; you need it in steps 4 and 5.

## 4. Deploy the Edge Function

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@gmail.com CRON_SECRET=...
npx supabase functions deploy send-reminders --no-verify-jwt
```

- `YOUR_PROJECT_REF` is the `abcd1234` part of `https://abcd1234.supabase.co`.
- `--no-verify-jwt` is needed because the cron job isn't a signed-in user; the
  function checks `CRON_SECRET` instead.
- If the CLI says the project isn't initialised, run `npx supabase init` once
  (answer **N** to the questions), then repeat the deploy.

## 5. Schedule it every minute

1. Supabase → **Database → Extensions**: enable **pg_cron** and **pg_net**.
2. Open [`supabase/migrations/004_reminder_cron.sql`](supabase/migrations/004_reminder_cron.sql),
   replace `<PROJECT_REF>` and `<CRON_SECRET>`, then run it in the SQL Editor.
   (Don't save the file with the real secret in it.)

## 6. Try it

1. Open the app, signed in. Gear ⚙ → turn on **Notifications** → allow when the browser asks.
2. Create a task with a reminder 2 minutes from now.
3. Close the tab. Within a minute of the reminder time, a notification appears.
   Tapping it opens the app.

Repeating reminders reopen the task each time they go off, so "Wash motorcycle,
every Saturday" is back on your list every Saturday morning.

### Phones

- **Android (Chrome):** works in the browser. Installing to the home screen is optional.
- **iPhone (iOS 16.4+):** Apple only allows notifications for web apps added to the
  Home Screen. Open the site in Safari → Share → **Add to Home Screen**, open it from
  there, then turn on Notifications in the gear menu.
- Notifications need **https** (or `localhost`). Testing from your phone against the
  dev server on your PC won't work over plain `http://192.168...`; deploy the app
  (e.g. Netlify or Vercel) to test on a phone.

### Guest mode

Guests have no account, so the server can't send them anything. Guest reminders
only appear **while the app is open** in a tab. Creating an account fixes that.

## Troubleshooting

Run these in the SQL Editor:

```sql
-- Is the job running? (should show a row every minute)
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;

-- What did the function answer?  {"due":1,"sent":1} means a notification went out.
select status_code, content from net._http_response order by created desc limit 5;

-- Which reminders are waiting?
select title, next_notify_at, repeat, tz from tasks where next_notify_at is not null order by next_notify_at;

-- Is your device registered?
select endpoint, created_at from push_subscriptions;
```

- **403 Forbidden:** `CRON_SECRET` in the SQL job doesn't match the one set in step 4.
- **`sent: 0` but `due: 1`:** no device registered; turn Notifications on again in the gear menu.
- **Edge Function errors:** Supabase → **Edge Functions → send-reminders → Logs**.
