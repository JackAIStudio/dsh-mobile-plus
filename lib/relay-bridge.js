import { request as httpRequest } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './constants.js'

export class RelayBridge {
  /**
   * @param {number} targetPort - local DSH loopback port (e.g. 3080 or 3180)
   * @param {Object} [config] - optional config passed to plugin
   */
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
  }

  resolveRelayConfig() {
    let server = (this.config.relayServer || '').trim()
    let token = (this.config.relayToken || '').trim()
    let enabled = this.config.relayEnabled !== false
    let publicBaseUrl = (this.config.publicBaseUrl || '').trim()

    if (!server || !token) {
      try {
        const file = join(dshHome(), 'remote-relay.json')
        if (existsSync(file)) {
          const raw = readFileSync(file, 'utf8')
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            if (!server && parsed.server) server = parsed.server.trim()
            if (!token && parsed.token) token = parsed.token.trim()
            if (!publicBaseUrl && parsed.publicBaseUrl) publicBaseUrl = parsed.publicBaseUrl.trim()
            if (parsed.enabled !== undefined) enabled = Boolean(parsed.enabled)
          }
        }
      } catch {}
    }

    return {
      enabled: enabled && Boolean(server && token),
      server,
      token,
      publicBaseUrl,
    }
  }

  start() {
    if (!this.enabled || !this.server || !this.token) {
      return
    }
    this.stopped = false
    this.connect()
  }

  connect() {
    if (this.stopped) return
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return
    }

    clearTimeout(this.reconnectTimer)

    let wsUrl = this.server
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      if (wsUrl.startsWith('https://')) {
        wsUrl = wsUrl.replace(/^https:\/\//, 'wss://')
      } else if (wsUrl.startsWith('http://')) {
        wsUrl = wsUrl.replace(/^http:\/\//, 'ws://')
      } else {
        wsUrl = `wss://${wsUrl}`
      }
    }

    const urlObj = new URL(wsUrl)
    if (!urlObj.pathname || urlObj.pathname === '/') {
      urlObj.pathname = '/relay/tunnel'
    }
    urlObj.searchParams.set('token', this.token)
    const isDesktop = process.env.DSH_DESKTOP_ISOLATED === '1'
    const clientId = isDesktop ? `jackdsh_${process.platform}` : `dsh_${process.platform}`
    urlObj.searchParams.set('client_id', clientId)

    try {
      this.ws = new WebSocket(urlObj.toString())
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 2000
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data)
    }

    this.ws.onclose = () => {
      this.cleanupStreams()
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // close will trigger reconnect
    }
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData.toString())
      if (msg.type === 'ping') {
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'pong' }))
        }
        return
      }

      const { reqId } = msg
      if (!reqId) return

      if (msg.type === 'req_start') {
        this.handleReqStart(msg)
        return
      }

      if (msg.type === 'req_data') {
        const stream = this.activeStreams.get(reqId)
        if (stream && stream.req && msg.chunk) {
          stream.req.write(Buffer.from(msg.chunk, 'base64'))
        }
        return
      }

      if (msg.type === 'req_end') {
        const stream = this.activeStreams.get(reqId)
        if (stream && stream.req) {
          stream.req.end()
        }
        return
      }
    } catch {}
  }

  handleReqStart(msg) {
    const { reqId, method, url, headers } = msg
    const targetHeaders = { ...headers }
    targetHeaders['host'] = headers['host'] || `127.0.0.1:${this.targetPort}`

    const options = {
      hostname: '127.0.0.1',
      port: this.targetPort,
      path: url,
      method: method || 'GET',
      headers: targetHeaders,
    }

    const localReq = httpRequest(options, (localRes) => {
      this.send({
        type: 'res_start',
        reqId,
        status: localRes.statusCode || 200,
        headers: localRes.headers,
      })

      localRes.on('data', (chunk) => {
        this.send({
          type: 'res_data',
          reqId,
          chunk: chunk.toString('base64'),
        })
      })

      localRes.on('end', () => {
        this.send({ type: 'res_end', reqId })
        this.activeStreams.delete(reqId)
      })

      localRes.on('error', (err) => {
        this.send({ type: 'res_error', reqId, message: err.message })
        this.activeStreams.delete(reqId)
      })
    })

    localReq.on('error', (err) => {
      this.send({
        type: 'res_error',
        reqId,
        message: `Failed to connect to local port ${this.targetPort}: ${err.message}`,
      })
      this.activeStreams.delete(reqId)
    })

    this.activeStreams.set(reqId, { req: localReq })
  }

  send(data) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(data))
    }
  }

  cleanupStreams() {
    for (const [, stream] of this.activeStreams.entries()) {
      try {
        if (stream.req && !stream.req.destroyed) stream.req.destroy()
      } catch {}
    }
    this.activeStreams.clear()
  }

  scheduleReconnect() {
    if (this.stopped) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    this.cleanupStreams()
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
  }
}

export function parseRelayToken(input) {
  if (typeof input !== 'string') throw new Error('口令必须是字符串')
  const text = input.trim()
  if (!text) throw new Error('口令不能为空')

  if (text.startsWith('jds://relay')) {
    const url = new URL(text.replace(/^jds:\/\//, 'http://dummy/'))
    const server = url.searchParams.get('s')
    const token = url.searchParams.get('t')
    const publicBaseUrl = url.searchParams.get('p') || ''
    if (!server || !token) throw new Error('口令缺少 server 或 token')
    return {
      enabled: true,
      server,
      token,
      publicBaseUrl: publicBaseUrl || (server.startsWith('ws') ? server.replace(/^wss?:\/\//, 'https://').replace(/\/relay\/tunnel.*$/, '') : ''),
    }
  }

  if (text.startsWith('{') && text.endsWith('}')) {
    const parsed = JSON.parse(text)
    if (!parsed.server || !parsed.token) throw new Error('JSON 缺少 server 或 token')
    return {
      enabled: true,
      server: parsed.server,
      token: parsed.token,
      publicBaseUrl: parsed.publicBaseUrl || '',
    }
  }

  throw new Error('未识别的中转口令格式')
}

export function encodeRelayToken(config) {
  const server = (config?.server || '').trim()
  const token = (config?.token || '').trim()
  const publicBaseUrl = (config?.publicBaseUrl || '').trim()
  if (!server || !token) throw new Error('缺少 server 或 token')
  const p = new URLSearchParams()
  p.set('s', server)
  p.set('t', token)
  if (publicBaseUrl) p.set('p', publicBaseUrl)
  return `jds://relay?${p.toString()}`
}
