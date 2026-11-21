import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { supabase } from '../supabase'
import { friendlyAuthError } from '../auth/errors'
import {
  validateCode,
  validateConfirm,
  validateEmail,
  validateExistingPassword,
  validateNewPassword,
} from '../auth/validation'
import { formatWait, lockedUntil, nextSendAt, recordFailure, recordSend, recordSuccess } from '../auth/throttle'
import Turnstile from '../auth/Turnstile'
import { captchaEnabled } from '../auth/captcha'
import type { CaptchaHandle } from '../auth/Turnstile'
import { LIMITS } from '../lib/limits'
import CodeInput from './CodeInput'

export type AuthTab = 'signin' | 'signup'
type Step = 'form' | 'verify'
type Field = 'email' | 'password' | 'confirm'
type FieldErrors = Partial<Record<Field | 'code', string>>

const CODE_LENGTH = 6
const RESEND_SECONDS = 60
const emptyCode = () => Array<string>(CODE_LENGTH).fill('')

interface Props {
  initialTab?: AuthTab
  // e.g. an expired confirmation link the user just clicked
  initialError?: string | null
  // true when a guest opened this screen to create an account
  fromGuest: boolean
  // tasks saved on this device that will be uploaded after signing in
  localTaskCount: number
  // Page mode: "Continue as guest". Modal mode: closes the dialog.
  onContinueAsGuest: () => void
  // Show as a dialog over the guest's task list instead of a full page.
  modal?: boolean
}

export default function AuthScreen({
  initialTab = 'signin',
  initialError = null,
  fromGuest,
  localTaskCount,
  onContinueAsGuest,
  modal = false,
}: Props) {
  const [tab, setTab] = useState<AuthTab>(initialTab)
  const [step, setStep] = useState<Step>('form')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState<string[]>(emptyCode)

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [formError, setFormError] = useState<string | null>(initialError)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  // Spam protection (see auth/throttle.ts and auth/Turnstile.tsx).
  const [lockEnd, setLockEnd] = useState(() => lockedUntil())
  const [clock, setClock] = useState(() => Date.now())
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<CaptchaHandle>(null)
  const lockLeft = Math.max(0, lockEnd - clock)

  // Tick once a second while locked, so the countdown updates.
  useEffect(() => {
    if (lockEnd <= clock) return
    const id = window.setTimeout(() => setClock(Date.now()), 1000)
    return () => window.clearTimeout(id)
  }, [lockEnd, clock])

  /** Hand the current CAPTCHA token to one request (tokens only work once). */
  function takeCaptcha(): { captchaToken?: string } {
    const token = captchaToken
    captchaRef.current?.reset()
    return token ? { captchaToken: token } : {}
  }

  /** Returns an error message if this action must wait, else null. */
  function blockedReason(kind: 'attempt' | 'email'): string | null {
    const now = Date.now()
    setClock(now)
    const locked = lockedUntil(now)
    if (locked) {
      setLockEnd(locked)
      return `Too many wrong attempts. Try again in ${formatWait(locked - now)}.`
    }
    if (kind === 'email') {
      const at = nextSendAt(now)
      if (at) return `You've asked for several emails. Wait ${formatWait(at - now)}, then try again.`
    }
    if (captchaEnabled && !captchaToken) return 'Still checking that you’re not a bot. Try again in a moment.'
    return null
  }

  function failedAttempt() {
    const until = recordFailure()
    if (until) {
      setLockEnd(until)
      setClock(Date.now())
    }
  }

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  function focusField(field: Field) {
    const ref = field === 'email' ? emailRef : field === 'password' ? passwordRef : confirmRef
    ref.current?.focus()
  }

  // Count down the "Resend code" timer once per second.
  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => window.clearTimeout(id)
  }, [resendIn])

  const isSignup = tab === 'signup'
  function validateField(field: Field, values = { email, password, confirm }): string | null {
    if (field === 'email') return validateEmail(values.email)
    if (field === 'password') {
      return isSignup ? validateNewPassword(values.password) : validateExistingPassword(values.password)
    }
    return isSignup ? validateConfirm(values.password, values.confirm) : null
  }

  // Re-check a field as the user types, but only after they've left it once,
  // so they aren't shouted at while still typing their first attempt.
  function update(field: Field, value: string) {
    const values = { email, password, confirm, [field]: value }
    if (field === 'email') setEmail(value)
    if (field === 'password') setPassword(value)
    if (field === 'confirm') setConfirm(value)
    setFormError(null)

    setFieldErrors((prev) => {
      const next = { ...prev }
      for (const f of ['email', 'password', 'confirm'] as Field[]) {
        if (touched[f] && (f === field || (f === 'confirm' && field === 'password'))) {
          next[f] = validateField(f, values) ?? undefined
        }
      }
      return next
    })
  }

  function blur(field: Field) {
    setTouched((prev) => ({ ...prev, [field]: true }))
    setFieldErrors((prev) => ({ ...prev, [field]: validateField(field) ?? undefined }))
  }

  function switchTab(next: AuthTab) {
    if (next === tab) return
    setTab(next)
    setStep('form')
    setFieldErrors({})
    setTouched({})
    setFormError(null)
    setNotice(null)
    setPassword('')
    setConfirm('')
  }

  function goToVerify(message: string, resendAfter = RESEND_SECONDS) {
    setStep('verify')
    setCode(emptyCode())
    setFieldErrors({})
    setFormError(null)
    setNotice(message)
    setResendIn(resendAfter)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setNotice(null)

    // Validate everything and jump to the first problem.
    const fields: Field[] = isSignup ? ['email', 'password', 'confirm'] : ['email', 'password']
    const errors: FieldErrors = {}
    for (const f of fields) {
      const msg = validateField(f)
      if (msg) errors[f] = msg
    }
    setFieldErrors(errors)
    setTouched({ email: true, password: true, confirm: true })
    const firstBad = fields.find((f) => errors[f])
    if (firstBad) {
      focusField(firstBad)
      return
    }

    const blocked = blockedReason(isSignup ? 'email' : 'attempt')
    if (blocked) {
      setFormError(blocked)
      return
    }

    const cleanEmail = email.trim().toLowerCase()
    setBusy(true)
    try {
      if (isSignup) await signUp(cleanEmail)
      else await signIn(cleanEmail)
    } finally {
      setBusy(false)
    }
  }

  async function signIn(cleanEmail: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
      options: takeCaptcha(),
    })
    if (!error) {
      recordSuccess()
      return // App.tsx hears about the new session through onAuthStateChange.
    }

    if (error.code === 'email_not_confirmed') {
      // They signed up but never confirmed. Send a fresh code and let them
      // finish here. (With CAPTCHA on, the token was just used up, so they
      // tap "Resend code" themselves; same if they've had too many emails.)
      if (captchaEnabled || nextSendAt()) {
        goToVerify("Your email isn't confirmed yet. Enter the code from our email, or tap Resend code.", 0)
        return
      }
      recordSend()
      const resent = await supabase.auth.resend({
        type: 'signup',
        email: cleanEmail,
        options: { emailRedirectTo: window.location.origin },
      })
      if (resent.error) {
        setFormError(`${friendlyAuthError(error)} ${friendlyAuthError(resent.error)}`)
        return
      }
      goToVerify(`Your email isn't confirmed yet. We sent a new code to ${cleanEmail}.`)
      return
    }

    setFormError(friendlyAuthError(error))
    if (error.code === 'invalid_credentials') {
      failedAttempt()
      setPassword('')
      focusField('password')
    }
  }

  async function signUp(cleanEmail: string) {
    recordSend()
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { emailRedirectTo: window.location.origin, ...takeCaptcha() },
    })

    if (error) {
      if (error.code === 'user_already_exists' || error.code === 'email_exists') {
        setFieldErrors({ email: friendlyAuthError(error) })
        focusField('email')
      } else if (error.code === 'weak_password') {
        setFieldErrors({ password: friendlyAuthError(error) })
        focusField('password')
      } else {
        setFormError(friendlyAuthError(error))
      }
      return
    }

    // With email confirmation on, Supabase doesn't reveal whether an email is
    // already registered. Instead it returns a user with no identities.
    if (data.user && data.user.identities?.length === 0) {
      setFieldErrors({ email: 'An account with this email already exists. Sign in instead.' })
      focusField('email')
      return
    }

    // Email confirmation is turned off in Supabase: we're already signed in.
    if (data.session) return

    goToVerify(`We sent a 6-digit code to ${cleanEmail}.`)
  }

  async function verify(token: string) {
    if (busy) return
    const problem = validateCode(token)
    if (problem) {
      setFieldErrors({ code: problem })
      return
    }
    const blocked = blockedReason('attempt')
    if (blocked) {
      setFieldErrors({ code: blocked })
      return
    }

    setBusy(true)
    setFieldErrors({})
    setFormError(null)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token,
      type: 'email',
      options: takeCaptcha(),
    })
    setBusy(false)

    if (error) {
      if (error.code === 'otp_expired' || /token/i.test(error.message)) failedAttempt()
      setFieldErrors({ code: friendlyAuthError(error) })
      setCode(emptyCode())
      return
    }
    recordSuccess()
    // App.tsx receives the session and leaves this screen.
  }

  async function resendCode() {
    const blocked = blockedReason('email')
    if (blocked) {
      setFormError(blocked)
      return
    }
    recordSend()
    setBusy(true)
    setFormError(null)
    setFieldErrors({})
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.origin, ...takeCaptcha() },
    })
    setBusy(false)
    if (error) {
      setFormError(friendlyAuthError(error))
      return
    }
    setCode(emptyCode())
    setNotice(`New code sent to ${email.trim().toLowerCase()}.`)
    setResendIn(RESEND_SECONDS)
  }

  async function signInWithGoogle() {
    setFormError(null)
    setNotice(null)
    setBusy(true)
    try {
      // If Google isn't enabled in Supabase, the redirect would land on a raw
      // JSON error page. Check the project's public auth settings first.
      if (!(await googleEnabled())) {
        setFormError(friendlyAuthError({ message: '', code: 'provider_disabled' }))
        return
      }
      // Leaves the page for Google, then comes back signed in. Guest tasks are
      // still in this browser, so App.tsx moves them into the account on return.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (error) setFormError(friendlyAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  function errorId(field: string) {
    return fieldErrors[field as Field] ? `${field}-error` : undefined
  }

  // ---------- Step 2: enter the code ----------

  if (step === 'verify') {
    return (
      <AuthFrame modal={modal} onClose={onContinueAsGuest}>
          <Brand />
          <h1 className="auth-title">Check your email</h1>
          <p className="auth-sub">
            Enter the 6-digit code, or tap the confirmation link in the email. If you open the link
            on this device, you'll be signed in automatically.
          </p>

          {notice && <p className="message notice" role="status">{notice}</p>}
          {formError && <p className="message error" role="alert">{formError}</p>}

          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault()
              verify(code.join(''))
            }}
          >
            <CodeInput
              digits={code}
              onChange={(d) => {
                setCode(d)
                setFieldErrors({})
              }}
              onComplete={verify}
              disabled={busy}
              invalid={!!fieldErrors.code}
              describedBy={fieldErrors.code ? 'code-error' : undefined}
            />
            {fieldErrors.code && (
              <p id="code-error" className="field-error" role="alert">{fieldErrors.code}</p>
            )}

            <Turnstile ref={captchaRef} onToken={setCaptchaToken} />

            <button className="btn primary block" type="submit" disabled={busy || lockLeft > 0}>
              {lockLeft > 0 ? `Try again in ${formatWait(lockLeft)}` : busy ? 'Checking…' : 'Verify and continue'}
            </button>
          </form>

          <div className="auth-row">
            <button
              type="button"
              className="link-btn"
              onClick={resendCode}
              disabled={busy || resendIn > 0}
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
            </button>
            <button
              type="button"
              className="link-btn muted"
              onClick={() => {
                setStep('form')
                setNotice(null)
                setFormError(null)
                setFieldErrors({})
              }}
            >
              Use a different email
            </button>
          </div>
      </AuthFrame>
    )
  }

  // ---------- Step 1: sign in / sign up ----------

  const showError = (f: Field) => touched[f] && fieldErrors[f]

  return (
    <AuthFrame modal={modal} onClose={onContinueAsGuest}>
        <Brand />
        <h1 className="auth-title">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-sub">
          {isSignup
            ? 'Sync your tasks and reminders across every device.'
            : 'Sign in to see your tasks on any device.'}
        </p>

        <div className="segmented" role="tablist" aria-label="Sign in or sign up">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignup}
            className={!isSignup ? 'active' : ''}
            onClick={() => switchTab('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignup}
            className={isSignup ? 'active' : ''}
            onClick={() => switchTab('signup')}
          >
            Sign up
          </button>
        </div>

        {fromGuest && localTaskCount > 0 && (
          <p className="move-note">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {localTaskCount} {localTaskCount === 1 ? 'task' : 'tasks'} on this device will move to your account.
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              ref={emailRef}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => update('email', e.target.value)}
              onBlur={() => blur('email')}
              autoComplete="email"
              placeholder="name@example.com"
              maxLength={LIMITS.email}
              aria-invalid={!!showError('email') || undefined}
              aria-describedby={errorId('email')}
            />
            {showError('email') && <p id="email-error" className="field-error">{fieldErrors.email}</p>}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-wrap">
              <input
                id="password"
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => update('password', e.target.value)}
                onBlur={() => blur('password')}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                maxLength={LIMITS.password}
                aria-invalid={!!showError('password') || undefined}
                aria-describedby={errorId('password')}
              />
              <button
                type="button"
                className="reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                <EyeIcon open={!showPassword} />
              </button>
            </div>
            {showError('password') && (
              <p id="password-error" className="field-error">{fieldErrors.password}</p>
            )}
          </div>

          {isSignup && (
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                ref={confirmRef}
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => update('confirm', e.target.value)}
                onBlur={() => blur('confirm')}
                autoComplete="new-password"
                maxLength={LIMITS.password}
                aria-invalid={!!showError('confirm') || undefined}
                aria-describedby={errorId('confirm')}
              />
              {showError('confirm') && (
                <p id="confirm-error" className="field-error">{fieldErrors.confirm}</p>
              )}
            </div>
          )}

          {formError && <p className="message error" role="alert">{formError}</p>}

          <Turnstile ref={captchaRef} onToken={setCaptchaToken} />

          <button className="btn primary block" type="submit" disabled={busy || (!isSignup && lockLeft > 0)}>
            {!isSignup && lockLeft > 0
              ? `Try again in ${formatWait(lockLeft)}`
              : busy
                ? 'Please wait…'
                : isSignup
                  ? 'Create account'
                  : 'Sign in'}
          </button>
        </form>

        <div className="divider"><span>or</span></div>

        <button type="button" className="btn secondary block google-btn" onClick={signInWithGoogle} disabled={busy}>
          <GoogleIcon />
          Continue with Google
        </button>

        {!modal && (
          <>
            <button type="button" className="btn ghost block guest-btn" onClick={onContinueAsGuest}>
              {fromGuest ? 'Back to my tasks' : 'Continue as guest'}
            </button>
            <p className="guest-note">
              {fromGuest
                ? 'Your tasks stay saved on this device until you sign in.'
                : 'Guest tasks are saved on this device only. You can create an account later to sync them.'}
            </p>
          </>
        )}
    </AuthFrame>
  )
}

// Asks Supabase (public endpoint) whether the Google provider is switched on.
// If the check itself fails, try anyway rather than block the user.
async function googleEnabled(): Promise<boolean> {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    if (!res.ok) return true
    const settings = (await res.json()) as { external?: Record<string, boolean> }
    return settings.external?.google !== false
  } catch {
    return true
  }
}

/** Full-page card on the start screen; a blurred-backdrop dialog over the guest's tasks. */
function AuthFrame({ modal, onClose, children }: { modal: boolean; onClose: () => void; children: ReactNode }) {
  if (!modal) {
    return (
      <main className="auth">
        <div className="auth-card">{children}</div>
      </main>
    )
  }
  return <AuthDialog onClose={onClose}>{children}</AuthDialog>
}

function AuthDialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  // Where the pointer went down, so drag-selecting text inside the card and
  // releasing outside it doesn't close the dialog.
  const downOnBackdrop = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="auth-modal"
      aria-label="Sign in or create an account"
      onCancel={(e) => {
        e.preventDefault() // Escape: let React unmount it
        onClose()
      }}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div className="auth-card">
        <button type="button" className="icon-btn auth-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {children}
      </div>
    </dialog>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

// The "Do" logo from public/do-logo.svg, drawn inline so the letters can
// follow the theme (dark navy would vanish on the dark background).
function Brand() {
  return (
    <div className="brand" aria-hidden="true">
      <svg className="brand-logo" viewBox="0 0 314 160" height="36">
        <path d="M40 30 H80 A50 50 0 0 1 80 130 H40 Z" fill="none" stroke="currentColor" strokeWidth="28" strokeLinejoin="round" />
        <circle cx="224" cy="80" r="50" fill="none" stroke="currentColor" strokeWidth="28" />
        <path d="M206 82 L220 96 L246 66" fill="none" stroke="#3b4eff" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// Eye = "show password"; eye with a slash = "hide password".
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  )
}
