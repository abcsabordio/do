import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import AuthScreen from './components/AuthScreen'
import type { AuthTab } from './components/AuthScreen'
import TaskList from './components/TaskList'
import GroupsView from './components/GroupsView'
import UndoProvider from './components/UndoProvider'
import SettingsMenu from './components/SettingsMenu'
import { disableNotifications, refreshPushSubscription } from './lib/push'
import { startLocalReminders } from './lib/localReminders'
import { StoreContext } from './data/store'
import type { TaskStore } from './data/store'
import { cloudStore } from './data/cloudStore'
import { localStore, readGuestData } from './data/localStore'
import { syncGuestData } from './data/syncGuestData'

type Tab = 'tasks' | 'groups'
type SyncState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; count: number }
  | { status: 'error'; message: string }

// ---------- Guest flag: remembers "this browser chose guest mode" ----------

const MODE_KEY = 'todo.mode'

function readGuestFlag(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) === 'guest'
  } catch {
    return false
  }
}

function writeGuestFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(MODE_KEY, 'guest')
    else localStorage.removeItem(MODE_KEY)
  } catch {
    // Storage blocked: guest mode still works for this visit.
  }
}

function hasGuestData(): boolean {
  const { tasks, groups } = readGuestData()
  return tasks.length > 0 || groups.length > 0
}

// If an emailed confirmation link (or Google sign-in) failed, Supabase sends
// the user back with the reason in the URL. Read it once, then tidy the URL.
// Only our own wording is shown: anyone can craft a link with any text in it,
// so displaying it as-is would let a phishing link "speak" for the app.
const linkErrorOnLoad: string | null = (() => {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
  if (!params.get('error') && !params.get('error_code')) return null
  window.history.replaceState(null, '', window.location.pathname)
  switch (params.get('error_code')) {
    case 'otp_expired':
      return 'That confirmation link has expired or was already used. Sign in to get a new code.'
    case 'provider_disabled':
      return "Google sign-in isn't set up yet. Use your email and password for now."
    default:
      return params.get('error') === 'access_denied'
        ? 'Sign-in was cancelled.'
        : "That sign-in link didn't work. Please try again."
  }
})()

// ---------- App ----------

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [guest, setGuest] = useState(readGuestFlag)
  // Set when a guest opens the sign in / sign up screen.
  const [authTab, setAuthTab] = useState<AuthTab | null>(null)
  const [linkError, setLinkError] = useState(linkErrorOnLoad)
  const [sync, setSync] = useState<SyncState>({ status: 'idle' })
  // Bumped after a sync so the task lists reload with the uploaded tasks.
  const [dataVersion, setDataVersion] = useState(0)
  const syncInFlight = useRef(false)

  // The "Moved N tasks…" success message hides itself after 5 seconds.
  // Errors stay until the user retries.
  useEffect(() => {
    if (sync.status !== 'done') return
    const id = window.setTimeout(() => setSync({ status: 'idle' }), 5000)
    return () => window.clearTimeout(id)
  }, [sync.status])

  const runSync = useCallback(async () => {
    if (syncInFlight.current) return
    syncInFlight.current = true
    setSync({ status: 'running' })
    try {
      const count = await syncGuestData()
      setSync({ status: 'done', count })
      setDataVersion((v) => v + 1)
    } catch (err) {
      setSync({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      syncInFlight.current = false
    }
  }, [])

  useEffect(() => {
    function handleSession(next: Session | null) {
      setSession(next)
      if (!next) return
      // Signed in: leave guest mode and upload any tasks made as a guest here.
      writeGuestFlag(false)
      setGuest(false)
      setAuthTab(null)
      setLinkError(null)
      if (hasGuestData()) runSync()
      void refreshPushSubscription()
    }

    // Restore an existing login when the page loads
    supabase.auth.getSession().then(({ data }) => {
      handleSession(data.session)
      setChecking(false)
    })

    // Stay in sync with sign in / sign out / token refresh (also across tabs,
    // so clicking the email link in a new tab signs this tab in too).
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      handleSession(newSession)
    })
    return () => data.subscription.unsubscribe()
  }, [runSync])

  if (checking) return <p className="empty">Loading…</p>

  if (session) {
    return (
      <AppShell
        store={cloudStore}
        dataVersion={dataVersion}
        headerRight={
          <SettingsMenu
            email={session.user.email}
            kind="cloud"
            actions={[
              {
                label: 'Sign out',
                danger: true,
                onClick: async () => {
                  setSync({ status: 'idle' })
                  // Stop this device getting this account's reminders.
                  await disableNotifications('cloud').catch(() => {})
                  supabase.auth.signOut()
                },
              },
            ]}
          />
        }
        banner={<SyncBanner state={sync} onRetry={runSync} onDismiss={() => setSync({ status: 'idle' })} />}
      />
    )
  }

  if (guest) {
    return (
      <>
      <AppShell
        store={localStore}
        dataVersion={dataVersion}
        headerRight={
          <>
            <span className="badge">Guest</span>
            <button type="button" className="btn primary small" onClick={() => setAuthTab('signup')}>
              Create account
            </button>
            <SettingsMenu kind="local" actions={[{ label: 'Sign in', onClick: () => setAuthTab('signin') }]} />
          </>
        }
        banner={
          <p className="hint">
            <svg className="hint-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 7v4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="8" cy="4.6" r="1" fill="currentColor" />
            </svg>
            <span>
              You're using guest mode. Tasks are saved on this device only.
              <br />
              Create an account to sync them across devices.
            </span>
          </p>
        }
      />
      {/* Sign in / sign up opens as a dialog over the (blurred) task list. */}
      {authTab && (
        <AuthScreen
          key={authTab}
          modal
          initialTab={authTab}
          fromGuest
          localTaskCount={readGuestData().tasks.length}
          onContinueAsGuest={() => setAuthTab(null)}
        />
      )}
      </>
    )
  }

  return (
    <AuthScreen
      initialError={linkError}
      fromGuest={false}
      localTaskCount={0}
      onContinueAsGuest={() => {
        writeGuestFlag(true)
        setGuest(true)
        setAuthTab(null)
        setLinkError(null)
      }}
    />
  )
}

// ---------- Layout shared by guest and signed-in modes ----------

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  {
    id: 'tasks',
    label: 'Tasks',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 12.2l2.6 2.6L16.2 9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'groups',
    label: 'Groups',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <path
          d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M3.5 10.5h17" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
]

interface ShellProps {
  store: TaskStore
  headerRight: ReactNode
  banner?: ReactNode
  dataVersion: number
}

function AppShell({ store, headerRight, banner, dataVersion }: ShellProps) {
  const [tab, setTab] = useState<Tab>('tasks')

  // Guests have no server to send reminders, so check for them while open.
  useEffect(() => (store.kind === 'local' ? startLocalReminders() : undefined), [store.kind])

  return (
    <StoreContext value={store}>
      <UndoProvider>
        <div className="app">
          <header className="app-header">
            <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
            <div className="who">{headerRight}</div>
          </header>

          {banner}

          {/* Both tabs stay mounted (one is hidden), so switching is instant
              and the Groups data is already loaded when you open it. */}
          <main key={`${store.kind}-${dataVersion}`}>
            {TABS.map((t) => (
              <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-label={t.label} hidden={tab !== t.id}>
                {t.id === 'tasks' ? <TaskList groupId={null} /> : <GroupsView />}
              </div>
            ))}
          </main>
        </div>

        <nav className="bottom-nav" aria-label="Sections">
          <div className="bottom-nav-inner" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                title={t.label}
                className={`nav-btn${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="nav-icon">{t.icon}</span>
                {/* The label only shows on the active tab (CSS expands it). */}
                <span className="nav-label">{t.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </UndoProvider>
    </StoreContext>
  )
}

function SyncBanner({
  state,
  onRetry,
  onDismiss,
}: {
  state: SyncState
  onRetry: () => void
  onDismiss: () => void
}) {
  if (state.status === 'idle') return null
  if (state.status === 'running') {
    return <p className="message info" role="status">Moving your tasks from this device into your account…</p>
  }
  if (state.status === 'error') {
    return (
      <div className="message error banner" role="alert">
        <span>Couldn't move your device tasks to your account: {state.message}. They're still saved on this device.</span>
        <button type="button" className="btn primary small" onClick={onRetry}>Retry</button>
      </div>
    )
  }
  return (
    <div className="message notice banner" role="status">
      <span>
        Moved {state.count} {state.count === 1 ? 'task' : 'tasks'} from this device into your account.
      </span>
      <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  )
}
