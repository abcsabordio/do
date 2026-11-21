import { useEffect, useId, useRef, useState } from 'react'
import { getTheme, setTheme } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { playCheck, setSoundEnabled, soundEnabled } from '../lib/sound'
import { useNotifications } from '../lib/useNotifications'

export interface MenuAction {
  label: string
  onClick: () => void
  danger?: boolean
}

interface Props {
  email?: string // shown at the top when signed in
  kind: 'cloud' | 'local' // signed in, or guest
  actions: MenuAction[]
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)

/** Gear button in the header that opens account and appearance settings. */
export default function SettingsMenu({ email, kind, actions }: Props) {
  const [open, setOpen] = useState(false)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const [sound, setSound] = useState(soundEnabled)
  const notify = useNotifications(kind)
  const canToggleNotify = notify.state === 'on' || notify.state === 'off'
  const notifyNote =
    notify.error ??
    {
      unsupported: isIos()
        ? 'On iPhone, add this app to your Home Screen (Share → Add to Home Screen), then turn this on from there.'
        : "This browser can't show notifications.",
      unconfigured: 'Notifications aren\'t set up yet: add VITE_VAPID_PUBLIC_KEY to .env.local.',
      denied: "Notifications are blocked for this site. Allow them in your browser's site settings.",
      on: kind === 'local' ? 'Guest reminders only appear while the app is open.' : null,
      off: null,
    }[notify.state ?? 'off']
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  // Close on outside tap or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function chooseTheme(next: Theme) {
    setTheme(next)
    setThemeState(next)
  }

  return (
    <div className="settings" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`gear-btn${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Settings"
        title="Settings"
      >
        <GearIcon />
      </button>

      {open && (
        <div id={panelId} className="settings-panel" role="dialog" aria-label="Settings">
          {email && (
            <div className="settings-account">
              <span className="settings-label">Signed in as</span>
              <span className="settings-email" title={email}>{email}</span>
            </div>
          )}

          <div className="settings-section">
            <span className="settings-label" id={`${panelId}-theme`}>Appearance</span>
            <div className="segmented theme-switch" role="radiogroup" aria-labelledby={`${panelId}-theme`}>
              {(['dark', 'light'] as Theme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={theme === t}
                  className={theme === t ? 'active' : ''}
                  onClick={() => chooseTheme(t)}
                >
                  {t === 'dark' ? <MoonIcon /> : <SunIcon />}
                  {t === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <span id={`${panelId}-notify`}>Notifications</span>
            <button
              type="button"
              role="switch"
              aria-checked={notify.state === 'on'}
              aria-labelledby={`${panelId}-notify`}
              aria-describedby={notifyNote ? `${panelId}-notify-note` : undefined}
              className={`switch${notify.state === 'on' ? ' on' : ''}`}
              disabled={notify.busy || notify.state === null || !canToggleNotify}
              onClick={() => (notify.state === 'on' ? notify.disable() : notify.enable())}
            >
              <span className="switch-knob" />
            </button>
          </div>
          {notifyNote && (
            <p id={`${panelId}-notify-note`} className="settings-note">
              {notifyNote}
            </p>
          )}

          <div className="settings-row">
            <span id={`${panelId}-sound`}>Sounds</span>
            <button
              type="button"
              role="switch"
              aria-checked={sound}
              aria-labelledby={`${panelId}-sound`}
              className={`switch${sound ? ' on' : ''}`}
              onClick={() => {
                setSoundEnabled(!sound)
                setSound(!sound)
                if (!sound) playCheck() // preview when turning on
              }}
            >
              <span className="switch-knob" />
            </button>
          </div>

          {actions.length > 0 && (
            <div className="settings-actions">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`settings-item${a.danger ? ' danger' : ''}`}
                  onClick={() => {
                    setOpen(false)
                    a.onClick()
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M10.3 3.6a1.7 1.7 0 0 1 3.4 0l.1.8a1.7 1.7 0 0 0 2.5 1.1l.7-.4a1.7 1.7 0 0 1 2.4 2.4l-.4.7a1.7 1.7 0 0 0 1 2.5l.9.1a1.7 1.7 0 0 1 0 3.4l-.9.1a1.7 1.7 0 0 0-1 2.5l.4.7a1.7 1.7 0 0 1-2.4 2.4l-.7-.4a1.7 1.7 0 0 0-2.5 1l-.1.9a1.7 1.7 0 0 1-3.4 0l-.1-.9a1.7 1.7 0 0 0-2.5-1l-.7.4a1.7 1.7 0 0 1-2.4-2.4l.4-.7a1.7 1.7 0 0 0-1-2.5l-.9-.1a1.7 1.7 0 0 1 0-3.4l.9-.1a1.7 1.7 0 0 0 1-2.5l-.4-.7a1.7 1.7 0 0 1 2.4-2.4l.7.4a1.7 1.7 0 0 0 2.5-1.1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M13.5 9.6A5.7 5.7 0 0 1 6.4 2.5a5.7 5.7 0 1 0 7.1 7.1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
