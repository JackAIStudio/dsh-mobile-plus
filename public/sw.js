/* PWA worker for the /mp mobile shell only — never caches API or session data. */
const CACHE_NAME = 'dsh-mobile-plus-shell-v7'
const OFFLINE_URL = '/mp/offline.html'
const SHELL_PATHS = new Set([
  '/mp/',
  '/mp/css/boot.css',
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
  self.skipWaiting()
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    // Keep both escape hatches on the device: the offline page, and the boot
    // document. A cached boot document still shows its static fallback when
    // the host is unreachable, which is better than an empty 503.
    // addAll is atomic: a half-filled cache is worse than none at all.
    await cache.addAll([OFFLINE_URL, '/mp/']).catch(() => cache.add(OFFLINE_URL).catch(() => {}))
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('dsh-mobile-plus-shell-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim())
  )
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
    // 页面导航遇到偶发网络断连（如手机刚唤醒或切网络），等待 400ms 平滑重试一次
    if (request.mode === 'navigate') {
      try {
        await new Promise((resolve) => setTimeout(resolve, 400))
        const retryRes = await fetch(request)
        if (retryRes.status < 500) {
          if (retryRes.ok && new URL(request.url).search === '') {
            const cache = await caches.open(CACHE_NAME)
            await cache.put(request, retryRes.clone())
          }
          return retryRes
        }
      } catch {}
    }

    const cache = await caches.open(CACHE_NAME)
    if (allowCachedResponse) {
      const cached = await cache.match(request)
      if (cached !== undefined) return cached
    }
    const fallback = await cache.match(fallbackPath)
    if (fallback !== undefined) return fallback
    // Never answer a navigation with an empty body: that is exactly the blank
    // screen this worker is supposed to prevent. Say what happened instead.
    if (request.mode === 'navigate') {
      return new Response(OFFLINE_FALLBACK_HTML, {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}

const OFFLINE_FALLBACK_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>手机远程</title><style>
body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
padding:32px;box-sizing:border-box;text-align:center;background:#f3f5f9;color:#1c2333;
font:16px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}
p{margin:0;color:#64748b}a{display:inline-flex;align-items:center;justify-content:center;min-width:132px;
height:40px;padding:0 18px;border-radius:10px;background:#2f6fed;color:#fff;text-decoration:none;font-weight:600}
@media(prefers-color-scheme:dark){body{background:#111418;color:#e8eaed}p{color:#9aa3ad}}
</style></head><body><p>连不上正在运行的 DSH。</p><a href="/mp/">重新加载</a></body></html>`

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
