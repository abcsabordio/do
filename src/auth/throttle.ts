/**
 * Brakes on repeated sign-in attempts, kept in this browser.
 *
 * - Wrong passwords / codes: after 3 in a row the form locks for 30 s, then
 *   60 s, 2 min… up to 15 min. A successful sign-in resets it.
 * - Emails (sign up, resend code): at most 3 per 15 minutes.
 *
 * This is the polite, visible layer. It can be bypassed by clearing site
 * data, so the real protection is on the server: Supabase's per-IP rate
 * limits and (optionally) the CAPTCHA in Turnstile.tsx. See README → Security.
 */

const KEY = 'todo.authThrottle'

const FREE_FAILURES = 3
const BASE_LOCK_MS = 30_000
const MAX_LOCK_MS = 15 * 60_000
const FORGET_FAILURES_MS = 60 * 60_000 // a quiet hour wipes the slate

const SEND_LIMIT = 3
const SEND_WINDOW_MS = 15 * 60_000

interface State {
  failures: number
  lastFailure: number
  lockedUntil: number
  sends: number[] // timestamps of recent emails
}

const empty = (): State => ({ failures: 0, lastFailure: 0, lockedUntil: 0, sends: [] })

function read(): State {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...empty(), ...(JSON.parse(raw) as Partial<State>) } : empty()
  } catch {
    return empty()
  }
}

function write(state: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage blocked: the server-side limits still apply.
  }
}

/** Epoch ms until which sign-in is locked (0 = not locked). */
export function lockedUntil(now = Date.now()): number {
  const s = read()
  return s.lockedUntil > now ? s.lockedUntil : 0
}

/** Count a wrong password or code. Returns the new lock end (0 = none yet). */
export function recordFailure(now = Date.now()): number {
  const s = read()
  if (now - s.lastFailure > FORGET_FAILURES_MS) s.failures = 0
  s.failures += 1
  s.lastFailure = now
  if (s.failures >= FREE_FAILURES) {
    const lock = Math.min(BASE_LOCK_MS * 2 ** (s.failures - FREE_FAILURES), MAX_LOCK_MS)
    s.lockedUntil = now + lock
  }
  write(s)
  return s.lockedUntil > now ? s.lockedUntil : 0
}

/** Signed in: forget past failures. */
export function recordSuccess() {
  const s = read()
  write({ ...s, failures: 0, lastFailure: 0, lockedUntil: 0 })
}

/** Epoch ms when another email may be sent (0 = now). */
export function nextSendAt(now = Date.now()): number {
  const recent = read().sends.filter((t) => now - t < SEND_WINDOW_MS)
  return recent.length < SEND_LIMIT ? 0 : recent[0] + SEND_WINDOW_MS
}

export function recordSend(now = Date.now()) {
  const s = read()
  s.sends = [...s.sends.filter((t) => now - t < SEND_WINDOW_MS), now]
  write(s)
}

/** "0:42" / "12:05" */
export function formatWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
