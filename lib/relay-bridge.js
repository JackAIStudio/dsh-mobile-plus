import { request as httpRequest } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './constants.js'
export { parseRelayToken, encodeRelayToken } from './relay-token.js'

export class RelayBridge {
  constructor(targetPort, config = {}) {
    this.targetPort = targetPort
    this.config = config
    this.ws = null
    this.stopped = false
    this.reconnectTimer = null
    this.reconnectDelay = 2000
    this.activeStreams = new Map()

    const resolved = this.resolveRelayConfig()
    this.server = resolved.server
    this.token = resolved.token
    this.enabled = resolved.enabled
    this.publicBaseUrl = resolved.publicBaseUrl

    this.status = this.enabled ? 'disconnected' : 'disabled'
    this.connectedAt = null
    this.lastPingAt = null
    this.lastError = null
    const isDesktop = process.env.DSH_DESKTOP_ISOLATED === '1'
    this.clientId = isDesktop ? `jackdsh_${process.platform}` : `dsh_${process.platform}`
  }

  resolveRelayConfig() {
    let { relayServer: server = '', relayToken: token = '', relayEnabled, publicBaseUrl = '' } = this.config
    let enabled = relayEnabled !== false
    server = server.trim(); token = token.trim(); publicBaseUrl = publicBaseUrl.trim()
    if (!server || !token) {
      try {
        const file = join(dshHome(), 'remote-relay.json')
        if (existsSync(file)) {
          const parsed = JSON.parse(readFileSync(file, 'utf8'))
          if (parsed && typeof parsed === 'object') {
            if (!server && parsed.server) server = parsed.server.trim()
            if (!token && parsed.token) token = parsed.token.trim()
            if (!publicBaseUrl && parsed.publicBaseUrl) publicBaseUrl = parsed.publicBaseUrl.trim()
            if (parsed.enabled !== undefined) enabled = Boolean(parsed.enabled)
          }
        }
      } catch {}
    }
    return { enabled: enabled && Boolean(server && token), server, token, publicBaseUrl }
  }

  getStatus() {
    const isWsOpen = Boolean(this.ws && this.ws.readyState === 1)
    return {
      enabled: this.enabled,
      status: isWsOpen ? 'connected' : (this.enabled ? this.status : 'disabled'),
      server: this.server,
      publicBaseUrl: this.publicBaseUrl,
      clientId: this.clientId,
      targetPort: this.targetPort,
      connectedAt: isWsOpen ? this.connectedAt : null,
      lastPingAt: this.lastPingAt,
      lastError: this.lastError,
    }
  }

  async testHealth() {
    const start = Date.now()
    const isWsOpen = Boolean(this.ws && this.ws.readyState === 1)
    const resObj = { ok: false, tunnelConnected: isWsOpen, serverReachable: false, latencyMs: 0, clientId: this.clientId, targetPort: this.targetPort, publicBaseUrl: this.publicBaseUrl, error: null }
    if (!this.publicBaseUrl) { resObj.error = '未配置公网中转基地址'; return resObj }
    try {
      const u = new URL('/relay/health', this.publicBaseUrl)
      const res = await fetch(u.toString(), { signal: AbortSignal.timeout(5000) })
      resObj.latencyMs = Date.now() - start
      if (res.ok) { resObj.serverReachable = true; resObj.ok = isWsOpen }
      else { resObj.error = `云端返回状态码 ${res.status}` }
    } catch (e) {
      resObj.latencyMs = Date.now() - start; resObj.error = e.message || '无法连接云端中转'
    }
    return resObj
  }

  start() {
    if (!this.enabled || !this.server || !this.token) { this.status = 'disabled'; return }
    this.stopped = false
    this.connect()
  }

  connect() {
    if (this.stopped || (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1))) return
    clearTimeout(this.reconnectTimer)
    this.status = 'connecting'

    let wsUrl = this.server
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      wsUrl = wsUrl.startsWith('https://') ? wsUrl.replace(/^https:\/\//, 'wss://') : (wsUrl.startsWith('http://') ? wsUrl.replace(/^http:\/\//, 'ws://') : `wss://${wsUrl}`)
    }
    const urlObj = new URL(wsUrl)
    if (!urlObj.pathname || urlObj.pathname === '/') urlObj.pathname = '/relay/tunnel'
    urlObj.searchParams.set('token', this.token)
    urlObj.searchParams.set('client_id', this.clientId)
    urlObj.searchParams.set('info', `port:${this.targetPort}`)

    try {
      this.ws = new WebSocket(urlObj.toString())
    } catch (err) {
      this.lastError = err.message; this.status = 'error'; this.scheduleReconnect(); return
    }

    this.ws.onopen = () => { this.status = 'connected'; this.connectedAt = Date.now(); this.lastError = null; this.reconnectDelay = 2000 }
    this.ws.onmessage = (ev) => this.handleMessage(ev.data)
    this.ws.onclose = (ev) => {
      this.status = 'disconnected'; this.connectedAt = null; if (ev?.reason) this.lastError = ev.reason
      this.cleanupStreams(); this.scheduleReconnect()
    }
    this.ws.onerror = (err) => { this.lastError = err?.message || 'WebSocket 连接错误' }
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData.toString())
      if (msg.type === 'ping') {
        this.lastPingAt = Date.now()
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'pong' }))
        return
      }
      const { reqId } = msg
      if (!reqId) return
      if (msg.type === 'req_start') return this.handleReqStart(msg)
      if (msg.type === 'req_data') {
        const s = this.activeStreams.get(reqId)
        if (s?.req && msg.chunk) s.req.write(Buffer.from(msg.chunk, 'base64'))
        return
      }
      if (msg.type === 'req_end') {
        const s = this.activeStreams.get(reqId)
        if (s?.req) s.req.end()
      }
    } catch {}
  }

  handleReqStart(msg) {
    const { reqId, method, url, headers } = msg
    const targetHeaders = { ...headers, host: headers['host'] || `127.0.0.1:${this.targetPort}` }
    const localReq = httpRequest({ hostname: '127.0.0.1', port: this.targetPort, path: url, method: method || 'GET', headers: targetHeaders }, (localRes) => {
      this.send({ type: 'res_start', reqId, status: localRes.statusCode || 200, headers: localRes.headers })
      localRes.on('data', (chunk) => this.send({ type: 'res_data', reqId, chunk: chunk.toString('base64') }))
      localRes.on('end', () => { this.send({ type: 'res_end', reqId }); this.activeStreams.delete(reqId) })
      localRes.on('error', (err) => { this.send({ type: 'res_error', reqId, message: err.message }); this.activeStreams.delete(reqId) })
    })
    localReq.on('error', (err) => {
      this.send({ type: 'res_error', reqId, message: `Failed to connect local port ${this.targetPort}: ${err.message}` })
      this.activeStreams.delete(reqId)
    })
    this.activeStreams.set(reqId, { req: localReq })
  }

  send(data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(data))
  }

  cleanupStreams() {
    for (const [, stream] of this.activeStreams.entries()) {
      try { if (stream.req && !stream.req.destroyed) stream.req.destroy() } catch {}
    }
    this.activeStreams.clear()
  }

  scheduleReconnect() {
    if (this.stopped) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000)
  }

  stop() {
    this.stopped = true; this.status = 'disabled'; clearTimeout(this.reconnectTimer); this.cleanupStreams()
    if (this.ws) { try { this.ws.close() } catch {}; this.ws = null }
  }
}
