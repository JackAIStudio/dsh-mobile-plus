import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeQrSvg } from '../qrcodegen.js'
import {
  PREFIX,
  COOKIE,
  TOKEN_TTL_MS,
  IDLE_MS,
  COOKIE_MAX_AGE_SEC,
  OFFLINE_MS,
  dshHome,
} from './constants.js'
import {
  json,
  readBody,
  isLoopback,
  isLanHost,
  getLanIps,
  cookieValue,
  sameSecret,
  isHttps,
  svgDataUri,
  hostnameOf,
} from './utils.js'
import {
  deviceCookie,
  deviceId,
  pairingCode,
  loadDevices,
  saveDevices,
  aliveDevices,
} from './devices.js'

export { deviceCookie, deviceId, pairingCode, loadDevices, saveDevices, aliveDevices }

export class AuthManager {
  constructor(config = {}) {
    this.publicBaseUrl = (config.publicBaseUrl || '').trim().replace(/\/$/, '')
    if (!this.publicBaseUrl) {
      try {
        const raw = JSON.parse(readFileSync(join(dshHome(), 'remote-relay.json'), 'utf8'))
        if (raw?.publicBaseUrl) this.publicBaseUrl = raw.publicBaseUrl.trim().replace(/\/$/, '')
      } catch {}
    }
    this.requirePairing = config.requirePairing !== false
    this.publicHost = ''
    try {
      this.publicHost = this.publicBaseUrl === '' ? '' : new URL(this.publicBaseUrl).hostname
    } catch {
      this.publicHost = ''
    }
    this.devicesFile = config.devicesFile || join(dshHome(), 'mobile-plus-devices.json')
    this.devices = loadDevices(this.devicesFile)
    this.lanPort = typeof config.lanPort === 'number' ? config.lanPort : 0
    this.token = undefined
  }

  resolveEffectivePublicBaseUrl() {
    if (!this.publicBaseUrl) return ''
    const isDesktop = process.env.DSH_DESKTOP_ISOLATED === '1'
    try {
      const u = new URL(this.publicBaseUrl)
      if (!isDesktop && u.hostname.startsWith('mac.')) {
        u.hostname = `dev.${u.hostname}`
        return u.origin
      }
    } catch {}
    return this.publicBaseUrl
  }

  persist() {
    saveDevices(this.devicesFile, this.devices)
  }

  trustedHost(req) {
    if (isLoopback(req)) return true
    if (isLanHost(req)) return true
    const host = req.headers['x-forwarded-host'] || req.headers.host
    if (typeof host !== 'string' || host === '' || this.publicHost === '') return false
    const hostname = (hostnameOf(req) || host.split(':')[0]).toLowerCase()
    const pub = this.publicHost.toLowerCase()
    return hostname === pub || hostname === `dev.${pub}` || pub === `dev.${hostname}`
  }

  findByCookie(cookie) {
    if (typeof cookie !== 'string' || cookie === '') return undefined
    for (const id of Object.keys(this.devices)) {
      const row = this.devices[id]
      if (sameSecret(deviceCookie(id, row), cookie)) return { id, row }
    }
    return undefined
  }

  touch(req) {
    const found = this.findByCookie(cookieValue(req.headers.cookie, COOKIE))
    if (!found) return false
    if (Date.now() - found.row.lastSeenAt > IDLE_MS) {
      delete this.devices[found.id]
      this.persist()
      return false
    }
    found.row.lastSeenAt = Date.now()
    this.persist()
    return true
  }

  setDeviceCookie(resHeaders, secret, req) {
    const expires = new Date(Date.now() + COOKIE_MAX_AGE_SEC * 1000).toUTCString()
    const parts = [
      `${COOKIE}=${secret}`,
      `Path=${PREFIX}`,
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${COOKIE_MAX_AGE_SEC}`,
      `Expires=${expires}`,
    ]
    if (isHttps(req)) parts.push('Secure')
    resHeaders['set-cookie'] = parts.join('; ')
    return resHeaders
  }

  cookieHeadersIfPaired(req) {
    const found = this.findByCookie(cookieValue(req.headers.cookie, COOKIE))
    if (!found) return {}
    return this.setDeviceCookie({}, deviceCookie(found.id, found.row), req)
  }

  handleIssue = async (port, req, res, activeRelay = null) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!isLoopback(req)) {
      json(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    const secret = randomBytes(16).toString('hex')
    const code = pairingCode()
    this.token = { secret, code, expiresAt: Date.now() + TOKEN_TTL_MS, consumed: false }
    const lanIps = getLanIps()
    const primaryLanIp = lanIps[0] || ''
    const lanPort = this.lanPort || port
    const lanUrl = primaryLanIp !== '' ? `http://${primaryLanIp}:${String(lanPort)}${PREFIX}/?pair=${secret}` : ''
    const localUrl = `http://127.0.0.1:${String(port)}${PREFIX}/?pair=${secret}`
    const effectivePublic = this.resolveEffectivePublicBaseUrl()
    const isDesktop = process.env.DSH_DESKTOP_ISOLATED === '1'
    const nodeId = isDesktop ? `jackdsh_${process.platform}` : `dsh_${process.platform}`
    const nodeSuffix = effectivePublic !== '' ? `&node=${encodeURIComponent(nodeId)}` : ''
    const defaultUrl = effectivePublic !== '' ? `${effectivePublic}${PREFIX}/?pair=${secret}${nodeSuffix}` : (lanUrl || localUrl)
    const relayInfo = activeRelay ? activeRelay.getStatus() : { enabled: false, status: 'disabled' }
    json(res, 200, {
      ok: true,
      url: defaultUrl,
      lanUrl,
      localUrl,
      lanIp: primaryLanIp,
      code,
      qr: svgDataUri(makeQrSvg(defaultUrl)),
      qrLan: lanUrl !== '' ? svgDataUri(makeQrSvg(lanUrl)) : '',
      qrLocal: svgDataUri(makeQrSvg(localUrl)),
      expiresAt: this.token.expiresAt,
      publicBaseUrl: effectivePublic || this.publicBaseUrl,
      relay: relayInfo,
    })
  }

  handleAccept = async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!this.trustedHost(req)) {
      json(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    let body
    try {
      body = await readBody(req, 4096)
    } catch {
      json(res, 400, { ok: false, code: 'bad-payload' })
      return
    }
    const offered = typeof body.token === 'string' ? body.token.trim() : ''
    const valid = Boolean(
      this.token
      && !this.token.consumed
      && Date.now() <= this.token.expiresAt
      && (sameSecret(this.token.secret, offered) || (this.token.code && sameSecret(this.token.code, offered))),
    )
    if (!valid) {
      json(res, 404, { ok: false, code: 'invalid-token' })
      return
    }
    this.token.consumed = true
    const id = deviceId()
    const cookieSecret = deviceId()
    this.devices[id] = {
      secret: cookieSecret,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      label: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 180) : 'phone',
    }
    this.persist()
    json(res, 200, { ok: true, deviceId: id }, this.setDeviceCookie({}, cookieSecret, req))
  }

  handleStatus = (req, res, activeRelay = null) => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!this.trustedHost(req)) {
      json(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    const paired = this.requirePairing ? this.touch(req) : true
    const extra = paired && this.requirePairing ? this.cookieHeadersIfPaired(req) : {}
    const effectivePublic = this.resolveEffectivePublicBaseUrl() || this.publicBaseUrl
    const relayInfo = activeRelay ? activeRelay.getStatus() : { enabled: false, status: 'disabled' }
    if (!isLoopback(req)) {
      json(res, 200, {
        ok: true,
        paired,
        deviceCount: 0,
        onlineCount: 0,
        devices: [],
        publicBaseUrl: effectivePublic,
        relay: relayInfo,
      }, extra)
      return
    }
    const alive = aliveDevices(this.devices)
    if (alive.cleaned) this.persist()
    const now = Date.now()
    const rows = Object.entries(this.devices).map(([id, row]) => ({
      id,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      userAgent: row.label,
      online: now - row.lastSeenAt < OFFLINE_MS,
    }))
    json(res, 200, {
      ok: true,
      paired,
      deviceCount: alive.count,
      onlineCount: rows.filter((row) => row.online).length,
      devices: rows,
      publicBaseUrl: effectivePublic,
      relay: relayInfo,
    }, extra)
  }

  handleStop = (req, res) => {
    if (req.method !== 'POST') return res.writeHead(405).end()
    if (!isLoopback(req)) return json(res, 403, { ok: false, code: 'forbidden' })
    this.token = undefined
    for (const id of Object.keys(this.devices)) delete this.devices[id]
    this.persist()
    json(res, 200, { ok: true })
  }

  handleRevoke = async (req, res) => {
    if (req.method !== 'POST') return res.writeHead(405).end()
    if (!isLoopback(req)) return json(res, 403, { ok: false, code: 'forbidden' })
    let body
    try {
      body = await readBody(req, 4096)
    } catch {
      return json(res, 400, { ok: false, code: 'bad-payload' })
    }
    const id = typeof body.deviceId === 'string' ? body.deviceId : ''
    if (id === '' || !Object.prototype.hasOwnProperty.call(this.devices, id)) {
      return json(res, 404, { ok: false, code: 'unknown-device' })
    }
    delete this.devices[id]
    this.persist()
    json(res, 200, { ok: true })
  }
}
