# To Do

A to-do app with reminders that runs in the browser, installs on phones, and
syncs between devices through a free Supabase backend.

- **Tasks and groups.** Add, edit, tick off, drag to reorder, long-press to select several.
- **Reminders.** A date and time per task, repeating daily, weekly or monthly, with
  push notifications even when the app is closed.
- **Accounts or guest mode.** Sign in with email (6-digit code or link) or Google,
  or use it as a guest. Guest tasks stay on the device and move into your account
  when you sign up.
- **Light and dark themes, sounds, installable (PWA).**

---

## Contents

- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Database](#database)
- [Security](#security)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- More guides: [Notifications](docs/NOTIFICATIONS.md) · [Deployment and APK](docs/DEPLOYMENT.md)

---

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer and a free [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local
```

1. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`
   (Supabase → **Project Settings → API**).
2. In Supabase → **SQL Editor**, run the files in [`supabase/migrations`](supabase/migrations)
   **in order**: `001`, `002`, `003`, `005`. (`004` is optional; see
   [Notifications](docs/NOTIFICATIONS.md).)
3. Start the app:

   ```bash
   npm run dev
   ```

   and open http://localhost:5173.

Reminder notifications need a few more steps: [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md).

## Environment variables

Kept in `.env.local`, which git ignores. **Anything starting with `VITE_` is
built into the website and visible to everyone**, so only public values get that prefix.

| Name | Public? | Where it's used | Where to get it |
|---|---|---|---|
| `VITE_SUPABASE_URL` | yes | the app | Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | yes | the app; safe because of [row-level security](#what-protects-your-data) | same |
| `VITE_VAPID_PUBLIC_KEY` | yes | the app, for push notifications | `npx web-push generate-vapid-keys` |
| `VITE_TURNSTILE_SITE_KEY` | yes | optional bot check on sign in | [CAPTCHA](#captcha-optional) |
| `VAPID_PRIVATE_KEY` | **secret** | read by `npm run push:setup`, stored in Supabase secrets | same command as the public key |
| `CRON_SECRET` | **secret** | proves the every-minute job may call the function | created by `npm run push:setup` |
| `VAPID_SUBJECT` | no | contact for push services (`mailto:…`) | asked by `npm run push:setup` |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload |
| `npm run build` | Type-check and build the website into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | Check the code with oxlint |
| `npm test` | Run the logic tests ([Testing](#testing)) |
| `npm run push:setup` | Set up reminder notifications in Supabase ([guide](docs/NOTIFICATIONS.md)) |
| `npm run email:push` | Upload the sign-up email template and 6-digit code setting to Supabase |

The last two need a Supabase personal access token in `SUPABASE_ACCESS_TOKEN`
(see the comment at the top of each script). Delete the token when you're done.

## Project structure

```
src/
  main.tsx               Entry point; registers the service worker
  App.tsx                Sign-in state, guest mode, guest → account sync, tabs
  supabase.ts            The Supabase client
  types.ts               Task, TaskGroup, Repeat
  index.css              All styles; theme colours are CSS variables at the top

  auth/
    validation.ts        Email, password and code rules
    errors.ts            Supabase auth errors → readable messages
    throttle.ts          Lockout after repeated wrong passwords/codes, email limits
    Turnstile.tsx        Optional CAPTCHA widget (captcha.ts holds the on/off flag)

  components/
    AuthScreen.tsx       Sign in / sign up / code entry (full page or dialog)
    CodeInput.tsx        Six-box code field with paste and autofill
    TaskList.tsx         A list of tasks: add, tick, drag, select, delete with undo
    TaskRow.tsx          One task row (and the draggable version)
    TaskEditor.tsx       Dialog for title, description, reminder, repeat
    ReminderPicker.tsx   Date and time picker (quick picks, calendar, arrow/typed time)
    GroupsView.tsx       Groups tab: collapsible groups, each with its own TaskList
    SettingsMenu.tsx     Gear menu: theme, notifications, sounds, sign out
    Select.tsx           Accessible dropdown
    ConfirmDialog.tsx    "Are you sure?" dialog
    UndoProvider.tsx     The 5-second "Undo" toast

  data/
    store.ts             TaskStore interface + React context
    cloudStore.ts        TaskStore backed by Supabase (signed in)
    localStore.ts        TaskStore backed by localStorage (guest)
    syncGuestData.ts     Uploads guest data into a new account

  lib/
    limits.ts            Maximum text lengths (mirrored in the database)
    reminders.ts         Ordering, repeat maths, date formatting
    push.ts              Turning notifications on/off, push subscriptions
    useNotifications.ts  React hook around push.ts
    localReminders.ts    Guest reminders while the app is open
    selection.ts         Only one list can be in selection mode at a time
    useLongPress.ts      Long-press detection
    undo.ts              Undo context
    theme.ts, sound.ts   Light/dark theme; the "tock" when ticking a task

public/
  sw.js                  Service worker: shows push notifications
  manifest.webmanifest   Makes the app installable
  do-icon*.png/svg, do-logo.svg, apple-touch-icon.png

supabase/
  migrations/            SQL to run in the SQL Editor, in number order
  functions/send-reminders/  Edge Function that sends reminder pushes
  templates/             Sign-up email template

scripts/                 One-off setup scripts (see Scripts)
tests/                   Logic tests and database security tests
docs/                    Notifications and deployment guides
```

## How it works

### Guest vs. signed in

Every screen talks to a `TaskStore` ([`src/data/store.ts`](src/data/store.ts)),
never to Supabase directly. Signed-in users get `cloudStore` (Supabase); guests
get `localStore` (the browser's localStorage). Both behave the same, so the UI
doesn't care which one it has.

When a guest signs in or signs up, [`syncGuestData`](src/data/syncGuestData.ts)
uploads their groups and tasks, then clears the local copy. It reuses the
tasks' existing IDs with "insert, skip if it already exists", so if the upload
is interrupted and retried, nothing is duplicated.

### Ordering

Each task has a `position` number; lower is higher in the list. Dragging a task
gives it the average of its new neighbours' positions, so only that one row is saved.

### Reminders

A reminder is `remind_at` (first time), `repeat` (`daily`/`weekly`/`monthly` or
empty) and `tz` (the time zone it was set in). The database keeps
`next_notify_at` up to date with a trigger; the server sends what's due every
minute. Details: [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md).

## Database

Run in Supabase → SQL Editor, in order. Each file is safe to run again.

| File | What it does |
|---|---|
| [`001_base_schema.sql`](supabase/migrations/001_base_schema.sql) | `tasks` and `task_groups` tables (new projects only; does nothing if they exist) |
| [`002_task_details.sql`](supabase/migrations/002_task_details.sql) | Reminder, repeat and position columns |
| [`003_push_reminders.sql`](supabase/migrations/003_push_reminders.sql) | Time zones, `next_notify_at`, device table, `claim_due_reminders()` |
| [`004_reminder_cron.sql`](supabase/migrations/004_reminder_cron.sql) | Every-minute job (or let `npm run push:setup` do it) |
| [`005_hardening.sql`](supabase/migrations/005_hardening.sql) | Security: strict row-level security, length limits, row caps, private functions |

**Tables:** `task_groups` (id, user_id, name, created_at), `tasks` (id, user_id,
group_id, title, notes, is_done, created_at, completed_at, remind_at, repeat, tz,
position, next_notify_at), `push_subscriptions` (one row per device with
notifications on). Deleting a group deletes its tasks; deleting an account deletes everything.

## Security

### What protects your data

| Protection | Where |
|---|---|
| **Row-level security:** each account can only read, change or delete its own groups, tasks and devices. A task can only be put in one of your own groups. Visitors who aren't signed in get nothing. | `005_hardening.sql` |
| **Length limits** in the database, so even direct API calls can't store huge text (see [Text limits](#text-limits)). | `005_hardening.sql` |
| **Row caps:** 5,000 tasks and 200 groups per account, 10 notification devices. Stops a script from filling the database. | `005_hardening.sql` |
| **Server-only functions:** reminder maths lives in a `private` schema the API doesn't expose; `claim_due_reminders()` only works with the server's service key. | `005_hardening.sql` |
| **Bad time zones are rejected**, so one account can't break reminders for everyone. | `005_hardening.sql` |
| **Edge Function** only runs with the correct `CRON_SECRET` (compared in constant time) and never returns database error details. | `send-reminders/index.ts` |
| **Error links** from emails/Google only show the app's own wording, never text from the URL (stops phishing messages "from" the app). | `App.tsx` |
| **Notification taps** can only open pages of this app. | `sw.js` |
| **Secrets** never reach the browser: private keys and the cron secret live in Supabase secrets/Vault; `.env.local`, keystores and Supabase CLI files are git-ignored. | `.gitignore` |

### Sign-in spam protection

Two layers:

1. **In the app** ([`throttle.ts`](src/auth/throttle.ts)): after 3 wrong passwords
   or codes, the form locks for 30 seconds, then 1 min, 2 min… up to 15 minutes,
   with a countdown. Sign-up and "resend code" emails are limited to 3 per 15
   minutes. Buttons are disabled while a request is running, so double-clicks
   don't send twice. This is a courtesy layer: someone can clear their browser
   data to reset it.
2. **On the server**, which can't be bypassed. Set these in the Supabase dashboard:

   - **Authentication → Rate Limits:** for example 30 sign-ups and sign-ins per
     5 minutes per IP, 30 code verifications per 5 minutes, and an email limit
     that fits your SMTP provider (Gmail: ~30 per hour).
   - **Authentication → Sign In / Providers → Email:** *Confirm email* on,
     minimum password length **8**, password requirements **letters and digits**.
     This matches the app's rules, so they're enforced even if someone skips the app.
   - **CAPTCHA** (below): the strongest protection against bots.

#### CAPTCHA (optional)

Uses [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/), which
is free and usually invisible; it only shows a check when a visit looks automated.
Supabase verifies every token, so bots can't skip it.

1. Cloudflare dashboard → **Turnstile → Add widget**. Add your domains
   (`localhost` and your live site), mode **Managed**. Copy the **site key** and **secret key**.
2. Put the site key in `.env.local` **and** your host's environment variables:
   `VITE_TURNSTILE_SITE_KEY=...`. Deploy.
3. Only then, in Supabase → **Authentication → Attack Protection**: enable CAPTCHA,
   provider **Turnstile**, paste the **secret key**.

Do step 3 last. Once Supabase requires CAPTCHA, any copy of the app without the
site key can't sign anyone in. Google sign-in isn't affected (Google does its own checks).

### Text limits

The same numbers are in [`src/lib/limits.ts`](src/lib/limits.ts) (the app) and
[`005_hardening.sql`](supabase/migrations/005_hardening.sql) (the database).
Change both together.

| Field | Limit |
|---|---|
| Task title | 1–200 characters |
| Task description | 2,000 characters (a counter appears near the limit) |
| Group name | 1–80 characters |
| Email | 254 characters |
| Password | 8–72 characters, at least one letter and one number (72 bytes is bcrypt's limit) |
| Code | exactly 6 digits |

### Keeping it safe

- Never paste access tokens, private keys or the cron secret into chats, code or
  commits. If one leaks: delete or rotate it in Supabase and run `npm run push:setup` again.
- Back up the Android `signing.keystore` somewhere private; you need it for every update.
- `npm audit` checks dependencies for known vulnerabilities.

## Testing

```bash
npm run lint     # static checks
npm run build    # type-check + build
npm test         # 32 logic checks: validation, sign-in throttle, reminder maths, guest storage
```

**Database security tests** ([`tests/db`](tests/db)) need a local PostgreSQL
(not your Supabase project). They check row-level security between two users,
the length limits, row caps, time zones, the repeat maths and who can call which
function. From the project folder, with PostgreSQL's `bin` folder on your PATH:

```bash
createdb todo_test
psql -d todo_test -v ON_ERROR_STOP=1 -f tests/db/supabase-stub.sql
for f in 002_task_details 003_push_reminders 005_hardening; do
  psql -d todo_test -v ON_ERROR_STOP=1 -f supabase/migrations/$f.sql
done
psql -d todo_test -f tests/db/behaviour.sql | grep -E "PASS|FAIL"
dropdb todo_test
```

Every line should start with `PASS`. **Never run `supabase-stub.sql` against Supabase.**

## Troubleshooting

| Message | Fix |
|---|---|
| `Could not find the 'tz' column … in the schema cache` (or `remind_at`, `position`) | A migration hasn't been run. Run `002`, `003` and `005` in order. |
| `Missing Supabase settings` on start | `.env.local` is missing or incomplete. Copy `.env.example` and fill it in, then restart `npm run dev`. |
| Sign-up email is Supabase's plain default | The template didn't save, or it contains invalid `{{ }}`. Run `npm run email:push`. |
| Code in the email is 8 digits | Same as above; the script also sets the length to 6. |
| `Google sign-in isn't set up yet` | Turn on the Google provider in Supabase (needs a Google Cloud OAuth client). |
| Google sends you to the wrong page | Add your site to Supabase → Authentication → URL Configuration → Redirect URLs. |
| `The bot check didn't go through` | `VITE_TURNSTILE_SITE_KEY` doesn't match the widget, or the domain isn't listed in Cloudflare. |
| `You've reached the limit of 200 groups.` | Row cap from `005_hardening.sql`; delete some or raise the cap there. |
| Notifications don't arrive | See [docs/NOTIFICATIONS.md → Troubleshooting](docs/NOTIFICATIONS.md#troubleshooting). |
