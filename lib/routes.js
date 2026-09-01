import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { PREFIX, PUBLIC, ALLOW, MAX_BODY, MIME_MAP } from './constants.js'
import { json, readBody, isLoopback } from './utils.js'
import { handleUpload } from './upload.js'
import { pipeSse } from './events.js'

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

export function setupRoutes(ctx, auth, pendingTracker, dispatch) {
  const handleSetup = (req, res) => {
    if (!isLoopback(req)) {
      res.writeHead(403)
      res.end('setup is loopback only')
      return
    }
    handleStaticFile(join(PUBLIC, 'setup.html'), req, res)
  }

  const handleApp = (req, res) => {
    const extra = auth.requirePairing && auth.touch(req) ? auth.cookieHeadersIfPaired(req) : {}
    const body = readFileSync(join(PUBLIC, 'app.html'))
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    })
    res.end(body)
  }

  const handleEvents = async (req, res) => {
    await pipeSse(
      req,
      res,
      (signal) => ctx.apiProxy.events.mux({ rpcId: `mp-mux-${Date.now().toString(36)}`, payload: {} }, signal),
      auth,
      pendingTracker,
    )
  }

  const handleHostEvents = async (req, res) => {
    if (!ctx.apiProxy.events || typeof ctx.apiProxy.events.host !== 'function') {
      json(res, 404, { ok: false, error: { code: 'unavailable', message: 'host events unsupported' } })
      return
    }
    await pipeSse(
      req,
      res,
      (signal) => ctx.apiProxy.events.host({ rpcId: `mp-host-${Date.now().toString(36)}`, payload: {} }, signal),
      auth,
      pendingTracker,
    )
  }

  const handleApi = async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://x').pathname
    if (pathname === `${PREFIX}/api/events.mux`) {
      await handleEvents(req, res)
      return
    }
    if (pathname === `${PREFIX}/api/events.host`) {
      await handleHostEvents(req, res)
      return
    }
    if (pathname === `${PREFIX}/api/mobile.upload`) {
      await handleUpload(ctx, req, res)
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const method = pathname.slice(`${PREFIX}/api/`.length)
    if (!ALLOW.has(method)) {
      json(res, 403, { ok: false, error: { code: 'forbidden', message: method } })
      return
    }
    let envelope
    try {
      envelope = await readBody(req, method === 'session.prompt' ? MAX_BODY : 256 * 1024)
    } catch (error) {
      json(res, 400, { ok: false, error: { code: 'bad-request', message: String(error.message || error) } })
      return
    }
    const rpcId = typeof envelope.rpcId === 'string' ? envelope.rpcId : ''
    if (rpcId === '') {
      json(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing rpcId' } })
      return
    }
    try {
      const abort = new AbortController()
      res.on('close', () => { if (!res.writableEnded) abort.abort() })
      json(res, 200, await dispatch(method, envelope.payload, rpcId, abort.signal))
    } catch (error) {
      json(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } },
      })
    }
  }

  const handleStaticRoute = (req, res) => {
    const pathname = new URL(req.url || '/', 'http://x').pathname
    if (pathname === PREFIX || pathname === `${PREFIX}/`) {
      handleApp(req, res)
      return
    }
    if (pathname.startsWith(`${PREFIX}/`)) {
      const rel = pathname.slice(`${PREFIX}/`.length)
      const target = resolve(PUBLIC, rel)
      if (target.startsWith(PUBLIC) && existsSync(target)) {
        handleStaticFile(target, req, res)
        return
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }

  const routes = [
    { kind: 'exact', path: `${PREFIX}/setup`, handler: handleSetup },
    { kind: 'exact', path: PREFIX, handler: handleApp },
    { kind: 'exact', path: `${PREFIX}/`, handler: handleApp },
    { kind: 'exact', path: `${PREFIX}/pair/issue`, handler: (req, res) => auth.handleIssue(ctx.webServer.port, req, res) },
    { kind: 'exact', path: `${PREFIX}/pair/accept`, handler: auth.handleAccept },
    { kind: 'exact', path: `${PREFIX}/pair/status`, handler: auth.handleStatus },
    { kind: 'exact', path: `${PREFIX}/pair/stop`, handler: auth.handleStop },
    { kind: 'exact', path: `${PREFIX}/pair/revoke`, handler: auth.handleRevoke },
    { kind: 'exact', path: `${PREFIX}/api/events.mux`, handler: handleEvents },
    { kind: 'exact', path: `${PREFIX}/api/events.host`, handler: handleHostEvents },
    { kind: 'prefix', path: `${PREFIX}/api`, handler: handleApi },
    { kind: 'prefix', path: `${PREFIX}/`, handler: handleStaticRoute },
  ]

  const stop = routes.map((route) => ctx.webServer.register(route))
  return () => { for (const dispose of stop) dispose() }
}
