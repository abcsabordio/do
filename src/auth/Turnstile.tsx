import { useEffect, useImperativeHandle, useRef } from 'react'
import type { Ref } from 'react'
import { TURNSTILE_SITE_KEY as SITE_KEY } from './captcha'

/**
 * Optional CAPTCHA (Cloudflare Turnstile) for sign in, sign up and codes.
 *
 * Off unless VITE_TURNSTILE_SITE_KEY is set. When it's on, Supabase checks
 * every token on its server, so bots can't skip it by calling the API
 * directly. Most people never see a puzzle: Turnstile only shows one when
 * a visit looks suspicious. Setup: README → Security → CAPTCHA.
 */

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to load')))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Turnstile failed to load'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export interface CaptchaHandle {
  /** Tokens work once. Call after every request that used one. */
  reset: () => void
}

interface Props {
  onToken: (token: string | null) => void
  ref?: Ref<CaptchaHandle>
}

export default function Turnstile({ onToken, ref }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  })

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current(null)
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current)
    },
  }))

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false
    loadTurnstile()
      .then((api) => {
        if (cancelled || !box.current) return
        widgetId.current = api.render(box.current, {
          sitekey: SITE_KEY,
          theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
          appearance: 'interaction-only', // invisible unless a check is really needed
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => onTokenRef.current(null))
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [])

  if (!SITE_KEY) return null
  return <div ref={box} className="captcha" />
}
