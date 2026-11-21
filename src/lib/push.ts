import { supabase } from '../supabase'

/**
 * Turning reminder notifications on and off for this device.
 *
 * Signed in: the browser creates a "push subscription" (an address the
 * server can send to) and we store it in Supabase. The send-reminders Edge
 * Function uses it to deliver reminders even when the app is closed.
 *
 * Guest: there's no server, so reminders only appear while the app is open
 * (see localReminders.ts). We just need the browser's permission.
 */

// Hosting dashboards make it easy to paste the key with quotes, spaces or a
// line break around it; strip those so they can't break decoding.
const VAPID_PUBLIC_KEY =
  ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').replace(/["'\s]/g, '') || undefined

const BAD_KEY_MESSAGE =
  "Notifications can't be turned on: the site's VITE_VAPID_PUBLIC_KEY setting isn't a valid public key. " +
  'Copy the Public Key again (no quotes or spaces) into your hosting settings and redeploy.'
const LOCAL_KEY = 'todo.localNotify'

export type NotifyState =
  | 'unsupported' // this browser can't do it (e.g. iPhone Safari outside the home screen app)
  | 'unconfigured' // VITE_VAPID_PUBLIC_KEY is missing from .env.local
  | 'denied' // the user blocked notifications for this site
  | 'off'
  | 'on'

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker failed:', err))
}

const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator
const canPush = () => canNotify() && 'PushManager' in window

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

async function saveSubscription(sub: PushSubscription) {
  const { endpoint, keys } = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: keys?.p256dh,
    p_auth: keys?.auth,
  })
  if (error) throw new Error(`Couldn't save this device: ${error.message}`)
}

async function askPermission() {
  const result = await Notification.requestPermission()
  if (result === 'denied') {
    throw new Error('Notifications are blocked. Allow them in your browser\'s site settings, then try again.')
  }
  if (result !== 'granted') throw new Error('Notifications were not allowed.')
}

// The VAPID key is base64url text; the browser wants raw bytes.
// A real public key is 65 bytes starting with 0x04. Anything else (e.g. the
// private key pasted by mistake) gets a clear message instead of a crash.
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(base64)) throw new Error(BAD_KEY_MESSAGE)
  const clean = base64.replace(/=+$/, '')
  const padded = (clean + '='.repeat((4 - (clean.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  let raw: string
  try {
    raw = atob(padded)
  } catch {
    throw new Error(BAD_KEY_MESSAGE)
  }
  if (raw.length !== 65 || raw.charCodeAt(0) !== 4) throw new Error(BAD_KEY_MESSAGE)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

// ---------- Public API ----------

export async function getNotifyState(kind: 'cloud' | 'local'): Promise<NotifyState> {
  if (kind === 'local') {
    if (!canNotify()) return 'unsupported'
    if (Notification.permission === 'denied') return 'denied'
    return Notification.permission === 'granted' && localNotifyOn() ? 'on' : 'off'
  }
  if (!canPush()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  return (await currentSubscription()) ? 'on' : 'off'
}

export async function enableNotifications(kind: 'cloud' | 'local') {
  await askPermission()
  if (kind === 'local') {
    setLocalNotify(true)
    return
  }
  if (!VAPID_PUBLIC_KEY) throw new Error('Notifications aren\'t set up yet (missing VITE_VAPID_PUBLIC_KEY).')
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
  await saveSubscription(sub)
}

export async function disableNotifications(kind: 'cloud' | 'local') {
  if (kind === 'local') {
    setLocalNotify(false)
    return
  }
  if (!canPush()) return
  const sub = await currentSubscription()
  if (!sub) return
  await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
}

/**
 * After signing in, make sure this device's existing subscription is saved
 * under the account that's signed in now.
 */
export async function refreshPushSubscription() {
  try {
    if (!canPush() || !VAPID_PUBLIC_KEY || Notification.permission !== 'granted') return
    const sub = await currentSubscription()
    if (sub) await saveSubscription(sub)
  } catch (err) {
    console.warn(err)
  }
}

export function localNotifyOn(): boolean {
  try {
    return localStorage.getItem(LOCAL_KEY) !== 'off'
  } catch {
    return true
  }
}

function setLocalNotify(on: boolean) {
  try {
    localStorage.setItem(LOCAL_KEY, on ? 'on' : 'off')
  } catch {
    // ignore
  }
}
