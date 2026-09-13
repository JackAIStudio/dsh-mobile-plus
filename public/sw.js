/* PWA worker for the /mp mobile shell only — never caches API or session data. */
const CACHE_NAME = 'dsh-mobile-plus-shell-v5'
const OFFLINE_URL = '/mp/offline.html'
const SHELL_PATHS = new Set([
  '/mp/',
  '/mp/manifest.webmanifest',
  '/mp/apple-touch-icon.png',
  '/mp/apple-touch-icon-dev.png',
  '/mp/icon-192.png',
  '/mp/icon-512.png',
  '/mp/icon-dev-192.png',
  '/mp/icon-dev-512.png',
  '/mp/logo.svg',
  OFFLINE_URL,
])

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => key.startsWith('dsh-mobile-plus-shell-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)),
  )))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/mp/api' || url.pathname.startsWith('/mp/api/') || url.pathname.startsWith('/mp/pair/')) return

  const isNav = request.mode === 'navigate' && (url.pathname === '/mp/' || url.pathname === '/mp')
  if (isNav) {
    event.respondWith(networkFirst(request, OFFLINE_URL, false))
    return
  }
  if (SHELL_PATHS.has(url.pathname)) event.respondWith(networkFirst(request, url.pathname))
})

async function networkFirst(request, fallbackPath, allowCachedResponse = true) {
  try {
    const response = await fetch(request)
    if (response.status >= 500) throw new Error('shell unavailable')
    if (response.ok && new URL(request.url).search === '') {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(CACHE_NAME)
    if (allowCachedResponse) {
      const cached = await cache.match(request)
      if (cached !== undefined) return cached
    }
    const fallback = await cache.match(fallbackPath)
    if (fallback !== undefined) return fallback
    return new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    try {
      const text = event.data ? event.data.text() : ''
      data = text ? JSON.parse(text) : {}
    } catch {}
  }
  const isDev = self.location.hostname.startsWith('dev.') || self.location.hostname.startsWith('dev-')
  const defaultTitle = isDev ? '[Dev] 任务完成' : '任务完成'
  const title = data.title ? (isDev && !data.title.startsWith('[Dev]') ? `[Dev] ${data.title}` : data.title) : defaultTitle
  const body = data.body || '一个对话任务已完成'
  const sessionId = data.sessionId || ''
  const targetUrl = sessionId ? `/mp/#/s/${encodeURIComponent(sessionId)}` : '/mp/'
  const options = {
    body,
    icon: isDev ? '/mp/icon-dev-192.png' : '/mp/icon-192.png',
    tag: sessionId ? `task-done-${sessionId}` : 'task-done',
    renotify: true,
    data: {
      sessionId,
      url: targetUrl,
    },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const sessionId = data.sessionId || ''
  const targetUrl = data.url || (sessionId ? `/mp/#/s/${encodeURIComponent(sessionId)}` : '/mp/')
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus()
          if (sessionId && 'postMessage' in client) {
            client.postMessage({ type: 'dsh-open-session', sessionId })
          } else if (client.navigate) {
            await client.navigate(targetUrl)
          }
          return
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    }),
  )
})
