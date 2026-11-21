// One-shot setup for reminder notifications (steps 3–6 of SETUP-NOTIFICATIONS.md).
// Safe to run again: every step updates what's there instead of duplicating it.
//
// Usage (PowerShell), from the project folder:
//   $env:SUPABASE_ACCESS_TOKEN = "<token from https://supabase.com/dashboard/account/tokens>"
//   npm run push:setup
//
// Reads from .env.local: VITE_SUPABASE_URL, VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
// Adds to .env.local if missing: CRON_SECRET (random), VAPID_SUBJECT (asks you).
// Secrets are sent straight to Supabase and never printed.

import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

const ENV_FILE = '.env.local'
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) fail('Set SUPABASE_ACCESS_TOKEN first (see the top of this file).')

// ---------- .env.local ----------

let envText = readFileSync(ENV_FILE, 'utf8')
const read = (name) =>
  envText.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') || ''
function save(name, value) {
  envText = envText.replace(/\s*$/, '\n') + `${name}=${value}\n`
  writeFileSync(ENV_FILE, envText)
}

// A VITE_ name would let the private key into the website if code ever used it.
if (read('VITE_VAPID_PRIVATE_KEY') && !read('VAPID_PRIVATE_KEY')) {
  envText = envText.replace(/^(\s*)VITE_VAPID_PRIVATE_KEY(\s*=)/m, '$1VAPID_PRIVATE_KEY$2')
  writeFileSync(ENV_FILE, envText)
  step('Renamed VITE_VAPID_PRIVATE_KEY to VAPID_PRIVATE_KEY in .env.local (keeps it out of the website)')
}

const projectUrl = read('VITE_SUPABASE_URL')
const publicKey = read('VITE_VAPID_PUBLIC_KEY')
const privateKey = read('VAPID_PRIVATE_KEY')
if (!projectUrl) fail('VITE_SUPABASE_URL is missing from .env.local')
if (!publicKey || !privateKey) fail('Run `npx web-push generate-vapid-keys` and put both keys in .env.local first.')
const ref = new URL(projectUrl).hostname.split('.')[0]

let cronSecret = read('CRON_SECRET')
if (!cronSecret) {
  cronSecret = randomBytes(32).toString('hex')
  save('CRON_SECRET', cronSecret)
  step('Created a random CRON_SECRET in .env.local')
}

let subject = read('VAPID_SUBJECT')
if (!subject) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const email = (await rl.question('Contact email for browser push services (shown to them only if something breaks): ')).trim()
  rl.close()
  if (!/^\S+@\S+\.\S+$/.test(email)) fail('That doesn\'t look like an email address.')
  subject = `mailto:${email}`
  save('VAPID_SUBJECT', subject)
}

// ---------- Supabase Management API ----------

async function api(path, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) fail(`Supabase refused ${path} (HTTP ${res.status}): ${await res.text()}`)
  return res.status === 204 ? null : res.json().catch(() => null)
}
const sql = (query) => api('/database/query', { query })
const literal = (s) => `'${s.replace(/'/g, "''")}'`

// 1. Secrets for the Edge Function
await api('/secrets', [
  { name: 'VAPID_PUBLIC_KEY', value: publicKey },
  { name: 'VAPID_PRIVATE_KEY', value: privateKey },
  { name: 'VAPID_SUBJECT', value: subject },
  { name: 'CRON_SECRET', value: cronSecret },
])
step('Saved VAPID keys, contact and CRON_SECRET as Edge Function secrets')

// 2. Deploy the function (Supabase CLI, bundled in the cloud: no Docker needed)
console.log('\nDeploying send-reminders…')
const deploy = spawnSync(
  'npx',
  ['-y', 'supabase@latest', 'functions', 'deploy', 'send-reminders', '--project-ref', ref, '--no-verify-jwt', '--use-api'],
  { stdio: 'inherit', shell: true, env: process.env }
)
if (deploy.status !== 0) fail('Deploy failed (see the output above).')
step('Deployed the send-reminders function')

// 3. Extensions + the every-minute job
await sql('create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;')
step('Enabled pg_cron and pg_net')

await sql(`
do $$
declare
  wanted text[][] := array[
    array['project_url', ${literal(projectUrl)}],
    array['reminder_cron_secret', ${literal(cronSecret)}]
  ];
  i int;
  existing uuid;
begin
  for i in 1 .. array_length(wanted, 1) loop
    select id into existing from vault.secrets where name = wanted[i][1];
    if existing is null then
      perform vault.create_secret(wanted[i][2], wanted[i][1]);
    else
      perform vault.update_secret(existing, wanted[i][2]);
    end if;
  end loop;
end $$;

select cron.schedule(
  'send-reminders',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);`)
step('Scheduled the job to run every minute')

// 4. Call the function once, the same way the job does
// Everything is already set up by now, so a network hiccup here isn't fatal.
try {
  const res = await fetch(`${projectUrl}/functions/v1/send-reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  })
  const answer = await res.text()
  if (!res.ok) fail(`Test call failed (HTTP ${res.status}): ${answer}`)
  step(`Test call worked: ${answer}`)
} catch (err) {
  console.log(`! Couldn't reach the function for a test call (${err.cause?.code ?? err.message}).`)
  console.log('  Setup is done; the every-minute job will call it anyway. Run this script again later to re-test.')
}

console.log('\nAll set. Remove the token from this terminal with:  Remove-Item Env:SUPABASE_ACCESS_TOKEN')

function step(msg) {
  console.log(`✓ ${msg}`)
}
function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
