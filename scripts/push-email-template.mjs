// Saves the "Confirm signup" email template and a 6-digit code length to your
// Supabase project through the Management API, then prints what Supabase stored.
//
// Usage (PowerShell), from the project folder:
//   $env:SUPABASE_ACCESS_TOKEN = "<your personal access token>"
//   npm run email:push
//
// Create the token at https://supabase.com/dashboard/account/tokens
// Keep it secret: never commit it or paste it anywhere public.

import { readFileSync } from 'node:fs'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN first. See the comment at the top of this file.')
  process.exit(1)
}

// Work out the project ref (the "abcd1234" in https://abcd1234.supabase.co).
const env = readFileSync('.env.local', 'utf8')
const rawUrl = env.match(/^\s*VITE_SUPABASE_URL\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
if (!rawUrl) {
  console.error('Could not find VITE_SUPABASE_URL in .env.local')
  process.exit(1)
}
const ref = new URL(rawUrl).hostname.split('.')[0]

// Drop the instructions comment at the top of the file; it isn't part of the email.
const html = readFileSync('supabase/templates/confirm-signup.html', 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '')

const body = {
  mailer_subjects_confirmation: 'Your To Do code: {{ .Token }}',
  mailer_templates_confirmation_content: html,
  mailer_otp_length: 6,
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

if (!res.ok) {
  console.error(`Supabase refused the update (HTTP ${res.status}):`)
  console.error(await res.text())
  process.exit(1)
}

const saved = await res.json()
const content = saved.mailer_templates_confirmation_content ?? ''
console.log(`Project:            ${ref}`)
console.log(`Subject:            ${saved.mailer_subjects_confirmation}`)
console.log(`Code length:        ${saved.mailer_otp_length}`)
console.log(`Template saved:     ${content.includes('Confirm my email') ? 'yes (new design)' : 'NO'}`)
console.log(`Template has code:  ${content.includes('{{ .Token }}') ? 'yes' : 'NO'}`)
