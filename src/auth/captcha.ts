// Cloudflare Turnstile site key (public). When unset, CAPTCHA is off.
// See README → Security → CAPTCHA.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

export const captchaEnabled = Boolean(TURNSTILE_SITE_KEY)
