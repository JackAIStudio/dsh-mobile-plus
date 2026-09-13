import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PREFIX, PUBLIC, ALLOW, MAX_BODY, dshHome } from './constants.js'
import { json, readBody, isLoopback, svc } from './utils.js'
import { handleUpload } from './upload.js'
import { pipeSse } from './events.js'
import { handleAttachmentRequest } from './media.js'
import { parseRelayToken, encodeRelayToken } from './relay-bridge.js'
import { provisionRemoteRelay } from './ssh-provisioner.js'
import { getVapidPublicKey, addSubscription, removeSubscription } from './web-push.js'
import { handleStaticFile, renderAppHtml, renderManifestJson } from './pwa.js'

export { handleStaticFile }

export function setupRoutes(ctx, auth, pendingTracker, dispatch, getRelay) {
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
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    })
    res.end(renderAppHtml(req))
  }

  const handleEvents = async (req, res) => {
    await pipeSse(
      req,
      res,
      (signal) => {
        const proxy = svc(ctx, 'apiProxy')
        if (proxy?.events?.mux) {
          return proxy.events.mux({ rpcId: `mp-mux-${Date.now().toString(36)}`, payload: {} }, signal)
        }
        return (async function* () {
          yield { type: "ready", clientId: "mp-fallback" }
        })()
      },
      auth,
      pendingTracker,
    )
  }

  const handleHostEvents = async (req, res) => {
    const proxyHost = svc(ctx, 'apiProxy')
    if (!proxyHost?.events || typeof proxyHost.events.host !== 'function') {
      json(res, 404, { ok: false, error: { code: 'unavailable', message: 'host events unsupported' } })
      return
    }
    await pipeSse(
      req,
      res,
      (signal) => proxyHost.events.host({ rpcId: `mp-host-${Date.now().toString(36)}`, payload: {} }, signal),
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
    if (pathname === `${PREFIX}/api/attachment`) {
      await handleAttachmentRequest(ctx, auth, req, res)
      return
    }
    if (pathname === `${PREFIX}/api/push/key`) {
      json(res, 200, { ok: true, publicKey: getVapidPublicKey() })
      return
    }
    if (pathname === `${PREFIX}/api/push/subscribe` && req.method === 'POST') {
      try {
        const body = await readBody(req, 64 * 1024)
        const sub = body.subscription || body
        const ok = addSubscription(sub)
        json(res, 200, { ok })
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message || err) })
      }
      return
    }
    if (pathname === `${PREFIX}/api/push/unsubscribe` && req.method === 'POST') {
      try {
        const body = await readBody(req, 64 * 1024)
        const ok = removeSubscription(body.endpoint)
        json(res, 200, { ok })
      } catch (err) {
        json(res, 400, { ok: false, error: String(err.message || err) })
      }
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
    let pathname = new URL(req.url || '/', 'http://x').pathname
    if (pathname.startsWith(`${PREFIX}/`)) {
      pathname = pathname.slice(`${PREFIX}/`.length)
    } else if (pathname.startsWith(PREFIX)) {
      pathname = pathname.slice(PREFIX.length)
    }
    if (pathname.startsWith('/')) {
      pathname = pathname.slice(1)
    }
    if (pathname === '' || pathname === 'index.html' || pathname === 'app.html') {
      handleApp(req, res)
      return
    }
    if (pathname === 'manifest.webmanifest') {
      res.writeHead(200, {
        'content-type': 'application/manifest+json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(renderManifestJson(req))
      return
    }
    const target = resolve(PUBLIC, pathname)
    if (target.startsWith(PUBLIC) && existsSync(target)) {
      handleStaticFile(target, req, res)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }

  const handleRelayConfig = async (req, res) => {
    if (!isLoopback(req)) return json(res, 403, { ok: false, code: 'forbidden' })
    const activeRelay = getRelay ? getRelay() : null
    if (req.method === 'GET') {
      const cfg = activeRelay ? activeRelay.resolveRelayConfig() : {}
      return json(res, 200, {
        ok: true,
        config: cfg,
        tokenStr: cfg.server && cfg.token ? encodeRelayToken(cfg) : '',
        connected: activeRelay ? (activeRelay.ws?.readyState === 1) : false,
      })
    }
    if (req.method === 'POST') {
      try {
        const parsed = await readBody(req, 16384)
        let newConfig
        if (parsed.tokenStr) {
          newConfig = parseRelayToken(parsed.tokenStr)
        } else {
          newConfig = {
            enabled: parsed.enabled !== false,
            server: (parsed.server || '').trim(),
            token: (parsed.token || '').trim(),
            publicBaseUrl: (parsed.publicBaseUrl || '').trim(),
            updatedAt: new Date().toISOString(),
          }
        }
        const file = join(dshHome(), 'remote-relay.json')
        writeFileSync(file, JSON.stringify(newConfig, null, 2) + '\n', 'utf8')
        if (newConfig.publicBaseUrl) {
          auth.publicBaseUrl = newConfig.publicBaseUrl
          try { auth.publicHost = new URL(auth.publicBaseUrl).host } catch {}
        }
        if (activeRelay) {
          activeRelay.server = newConfig.server
          activeRelay.token = newConfig.token
          activeRelay.enabled = newConfig.enabled
          activeRelay.publicBaseUrl = newConfig.publicBaseUrl
          activeRelay.connect()
        }
        return json(res, 200, {
          ok: true,
          config: newConfig,
          tokenStr: newConfig.server && newConfig.token ? encodeRelayToken(newConfig) : '',
        })
      } catch (err) {
        return json(res, 400, { ok: false, error: err.message })
      }
    }
    res.writeHead(405).end()
  }

  const handleRelayProvision = async (req, res) => {
    if (!isLoopback(req)) return json(res, 403, { ok: false, code: 'forbidden' })
    if (req.method !== 'POST') return res.writeHead(405).end()
    try {
      const options = await readBody(req, 16384)
      const finalConfig = await provisionRemoteRelay(options)
      const file = join(dshHome(), 'remote-relay.json')
      writeFileSync(file, JSON.stringify(finalConfig, null, 2) + '\n', 'utf8')
      if (finalConfig.publicBaseUrl) {
        auth.publicBaseUrl = finalConfig.publicBaseUrl
        try { auth.publicHost = new URL(auth.publicBaseUrl).host } catch {}
      }
      const activeRelay = getRelay ? getRelay() : null
      if (activeRelay) {
        activeRelay.server = finalConfig.server
        activeRelay.token = finalConfig.token
        activeRelay.enabled = true
        activeRelay.publicBaseUrl = finalConfig.publicBaseUrl
        activeRelay.connect()
      }
      return json(res, 200, {
        ok: true,
        config: finalConfig,
        tokenStr: encodeRelayToken(finalConfig),
      })
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message })
    }
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
    { kind: 'exact', path: `${PREFIX}/relay/config`, handler: handleRelayConfig },
    { kind: 'exact', path: `${PREFIX}/relay/provision`, handler: handleRelayProvision },
    { kind: 'exact', path: `${PREFIX}/api/events.mux`, handler: handleEvents },
    { kind: 'exact', path: `${PREFIX}/api/events.host`, handler: handleHostEvents },
    { kind: 'exact', path: `${PREFIX}/api/attachment`, handler: (req, res) => handleAttachmentRequest(ctx, auth, req, res) },
    { kind: 'prefix', path: `${PREFIX}/api`, handler: handleApi },
    { kind: 'prefix', path: PREFIX, handler: handleStaticRoute },
  ]

  const stop = routes.map((route) => ctx.webServer.register(route))
  return () => { for (const dispose of stop) dispose() }
}
