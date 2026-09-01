import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  cookieValue,
  sameSecret,
  isHttps,
  svgDataUri,
} from './utils.js'

export function deviceCookie(id, row) {
  return typeof row?.secret === 'string' && row.secret !== '' ? row.secret : id
}

export function deviceId() {
  return randomBytes(16).toString('hex')
}

export function loadDevices(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && raw.devices && typeof raw.devices === 'object') return raw.devices
  } catch {
    /* first run */
  }
  return {}
}

export function saveDevices(file, devices) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, devices }, null, 2), { mode: 0o600 })
}

export function aliveDevices(devices) {
  const now = Date.now()
  let count = 0
  let cleaned = false
  for (const id of Object.keys(devices)) {
    const row = devices[id]
    if (now - row.lastSeenAt > IDLE_MS) {
      delete devices[id]
      cleaned = true
      continue
    }
    count += 1
  }
  return { count, cleaned }
}

export class AuthManager {
  constructor(config = {}) {
    this.publicBaseUrl = (config.publicBaseUrl || '').trim().replace(/\/$/, '')
    this.requirePairing = config.requirePairing !== false
    this.publicHost = ''
    try {
      this.publicHost = this.publicBaseUrl === '' ? '' : new URL(this.publicBaseUrl).host
    } catch {
      this.publicHost = ''
    }
    this.devicesFile = config.devicesFile || join(dshHome(), 'mobile-plus-devices.json')
    this.devices = loadDevices(this.devicesFile)
    this.token = undefined
  }

  persist() {
    saveDevices(this.devicesFile, this.devices)
  }

  trustedHost(req) {
    if (isLoopback(req)) return true
    const host = req.headers.host
    return typeof host === 'string' && this.publicHost !== '' && host === this.publicHost
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

  handleIssue = async (port, req, res) => {
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
    this.token = { secret, expiresAt: Date.now() + TOKEN_TTL_MS, consumed: false }
    const localUrl = `http://127.0.0.1:${String(port)}${PREFIX}/?pair=${secret}`
    const url = this.publicBaseUrl === '' ? localUrl : `${this.publicBaseUrl}${PREFIX}/?pair=${secret}`
    json(res, 200, {
      ok: true,
      url,
      localUrl,
      qr: svgDataUri(makeQrSvg(url)),
      qrLocal: svgDataUri(makeQrSvg(localUrl)),
      expiresAt: this.token.expiresAt,
      publicBaseUrl: this.publicBaseUrl,
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
    const offered = typeof body.token === 'string' ? body.token : ''
    const valid = Boolean(
      this.token
      && !this.token.consumed
      && Date.now() <= this.token.expiresAt
      && sameSecret(this.token.secret, offered),
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

  handleStatus = (req, res) => {
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
    if (!isLoopback(req)) {
      json(res, 200, {
        ok: true,
        paired,
        deviceCount: 0,
        onlineCount: 0,
        devices: [],
        publicBaseUrl: this.publicBaseUrl,
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
      publicBaseUrl: this.publicBaseUrl,
    }, extra)
  }

  handleStop = (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!isLoopback(req)) {
      json(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    this.token = undefined
    for (const id of Object.keys(this.devices)) delete this.devices[id]
    this.persist()
    json(res, 200, { ok: true })
  }

  handleRevoke = async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!isLoopback(req)) {
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
    const id = typeof body.deviceId === 'string' ? body.deviceId : ''
    if (id === '' || !Object.prototype.hasOwnProperty.call(this.devices, id)) {
      json(res, 404, { ok: false, code: 'unknown-device' })
      return
    }
    delete this.devices[id]
    this.persist()
    json(res, 200, { ok: true })
  }
}
