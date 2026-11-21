// Checks run in the browser before anything is sent to Supabase.
// Each returns an error message, or null when the value is fine.

// Not a full RFC check, just enough to catch typos like "me@gmail" or "me gmail.com".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Enter your email address.'
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address, like name@example.com.'
  return null
}

export interface PasswordRule {
  label: string
  test: (pw: string) => boolean
}

// Shown as a live checklist on the sign-up form.
export const PASSWORD_RULES: PasswordRule[] = [
  { label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { label: 'At least one letter', test: (pw) => /[A-Za-z]/.test(pw) },
  { label: 'At least one number', test: (pw) => /\d/.test(pw) },
]

export function validateNewPassword(pw: string): string | null {
  if (!pw) return 'Choose a password.'
  const failed = PASSWORD_RULES.find((rule) => !rule.test(pw))
  return failed ? `Password needs: ${failed.label.toLowerCase()}.` : null
}

// Sign-in only checks that something was typed: older accounts may
// predate the current rules, and the server decides if it's correct.
export function validateExistingPassword(pw: string): string | null {
  return pw ? null : 'Enter your password.'
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
