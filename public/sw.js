// Service worker: runs in the background, even when the app is closed,
// and shows reminder notifications pushed from the server.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: event.data ? event.data.text() : 'Reminder' }
  }

  event.waitUntil(
    self.registration.showNotification(String(data.title || 'Reminder').slice(0, 120), {
      body: String(data.body || '').slice(0, 300),
      tag: data.tag,
      renotify: true,
      icon: '/do-icon-192.png',
      data: { url: data.url || '/' },
    })
  )
})

// Tapping the notification opens the app (or focuses it if already open).
// Only ever opens a page of this app, whatever the push message says.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let url = '/'
  try {
    const wanted = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
    if (wanted.origin === self.location.origin) url = wanted.pathname + wanted.search
  } catch {
    // keep '/'
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow(url)
    })
  )
})
