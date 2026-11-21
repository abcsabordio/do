// Checks run in the browser before anything is sent to Supabase.
// Each returns an error message, or null when the value is fine.

import { LIMITS } from '../lib/limits'

// Not a full RFC check, just enough to catch typos like "me@gmail" or "me gmail.com".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Enter your email address.'
  if (value.length > LIMITS.email) return 'That email address is too long.'
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address, like name@example.com.'
  return null
}

// Bytes, not characters: an emoji counts as 4.
const byteLength = (s: string) => new TextEncoder().encode(s).length

export function validateNewPassword(pw: string): string | null {
  if (!pw) return 'Choose a password.'
  if (pw.length < LIMITS.passwordMin) return `Use at least ${LIMITS.passwordMin} characters.`
  if (byteLength(pw) > LIMITS.password) return `Use ${LIMITS.password} characters or fewer.`
  if (!/[A-Za-z]/.test(pw)) return 'Include at least one letter.'
  if (!/\d/.test(pw)) return 'Include at least one number.'
  return null
}

// Sign-in only checks that something was typed: older accounts may
// predate the current rules, and the server decides if it's correct.
export function validateExistingPassword(pw: string): string | null {
  if (!pw) return 'Enter your password.'
  if (byteLength(pw) > LIMITS.password) return 'Incorrect email or password.'
  return null
}

export function validateConfirm(pw: string, confirm: string): string | null {
  if (!confirm) return 'Type your password again.'
  return pw === confirm ? null : "Passwords don't match."
}

export function validateCode(code: string): string | null {
  if (code.length === 0) return 'Enter the 6-digit code from the email.'
  if (!/^\d{6}$/.test(code)) return 'The code is 6 digits.'
  return null
}
