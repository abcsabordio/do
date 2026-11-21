// Turns Supabase auth errors into messages a person can act on.
// Error codes: https://supabase.com/docs/guides/auth/debugging/error-codes

interface AuthErrorLike {
  message: string
  code?: string
  status?: number
  name?: string
}

export function friendlyAuthError(error: AuthErrorLike): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.'
    case 'email_not_confirmed':
      return 'This email has not been confirmed yet.'
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Sign in instead.'
    case 'weak_password':
      return 'That password is too easy to guess. Try a longer one with letters and numbers.'
    case 'email_address_invalid':
      return 'That email address is not valid.'
    case 'otp_expired':
      return 'That code is incorrect or has expired. Check it, or send a new one.'
    case 'over_email_send_rate_limit':
      return 'Too many emails sent. Wait a minute, then try again.'
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a moment, then try again.'
    case 'signup_disabled':
      return 'New sign-ups are turned off right now.'
    case 'user_banned':
      return 'This account has been suspended.'
    case 'captcha_failed':
      return "The bot check didn't go through. Reload the page and try again."
    case 'provider_disabled':
      return "Google sign-in isn't set up yet. Use your email and password for now."
  }

  // No response at all: offline, DNS problem, server down, etc.
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return "Can't reach the server. Check your internet connection and try again."
  }

  // Older Supabase versions sometimes omit `code`; fall back to the text.
  if (/invalid login credentials/i.test(error.message)) return 'Incorrect email or password.'
  if (/token has expired or is invalid/i.test(error.message)) {
    return 'That code is incorrect or has expired. Check it, or send a new one.'
  }

  return error.message || 'Something went wrong. Please try again.'
}
