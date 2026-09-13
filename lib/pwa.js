import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { PREFIX, PUBLIC, MIME_MAP } from './constants.js'

export function handleStaticFile(filePath, req, res) {
  try {
    const ext = extname(filePath).toLowerCase()
    const contentType = MIME_MAP[ext] || 'application/octet-stream'
    const body = readFileSync(filePath)
    const headers = {
      'content-type': contentType,
      'cache-control': 'no-store',
    }
    if (basename(filePath) === 'sw.js') {
      headers['service-worker-allowed'] = `${PREFIX}/`
    }
    res.writeHead(200, headers)
    res.end(body)
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
    } else {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Internal Server Error')
    }
  }
}

export function isDevEnvironment(req) {
  const isDesktop = process.env.DSH_DESKTOP_ISOLATED === '1'
  if (isDesktop) return false
  const rawHost = req?.headers?.['x-forwarded-host'] || req?.headers?.host || ''
  const host = rawHost.toLowerCase().split(':')[0].trim()
  if (host.startsWith('mac.') || host.startsWith('jack.')) return false
  return true
}

export function getPwaConfig(req) {
  const isDev = isDevEnvironment(req)
  return {
    isDev,
    appName: isDev ? 'DSH Dev' : 'Jack DSH',
    manifestId: isDev ? `${PREFIX}/dev` : `${PREFIX}/jack`,
    appleIcon: isDev ? `${PREFIX}/apple-touch-icon-dev.png` : `${PREFIX}/apple-touch-icon.png`,
    manifestUrl: `${PREFIX}/manifest.webmanifest${isDev ? '?env=dev' : ''}`,
    icons: isDev
      ? [
          { src: `${PREFIX}/icon-dev-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${PREFIX}/icon-dev-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ]
      : [
          { src: `${PREFIX}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${PREFIX}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
  }
}

export function renderAppHtml(req) {
  const pwa = getPwaConfig(req)
  let html = readFileSync(join(PUBLIC, 'app.html'), 'utf8')
  return html
    .replace('<title>远程访问</title>', `<title>${pwa.appName}</title>`)
    .replace('content="手机远程"', `content="${pwa.appName}"`)
    .replace('href="/mp/manifest.webmanifest"', `href="${pwa.manifestUrl}"`)
    .replace('href="/mp/apple-touch-icon.png"', `href="${pwa.appleIcon}"`)
}

export function renderManifestJson(req) {
  const pwa = getPwaConfig(req)
  return JSON.stringify({
    id: pwa.manifestId,
    name: pwa.appName,
    short_name: pwa.appName,
    start_url: `${PREFIX}/`,
    scope: `${PREFIX}/`,
    display: 'standalone',
    background_color: '#f3f5f9',
    theme_color: '#f3f5f9',
    icons: pwa.icons,
  }, null, 2)
}
