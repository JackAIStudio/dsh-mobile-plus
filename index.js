/**
 * dsh-mobile-plus — independent mobile remote with text + file prompts.
 * Own routes under /mp. Does not patch @linxin666/dsh-remote-web-ui.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, posix, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeQrSvg } from './qrcodegen.js'

export const name = 'dsh-mobile-plus'
export const inject = ['webServer', 'apiProxy', 'commands', 'agents']

const PREFIX = '/mp'
const COOKIE = 'mp_device'
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000
const IDLE_MS = 7 * 24 * 60 * 60 * 1000
/** A paired device counts as offline after this long without a touch. */
const OFFLINE_MS = 90 * 1000
const MAX_BODY = 12 * 1024 * 1024
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const ALLOW = new Set([
  'workspace.list',
  'workspace.create',
  'host.listDirectory',
  'agentPreset.list',
  'session.list',
  'session.create',
  'session.history',
  'session.prompt',
  'session.cancel',
  'session.attachment',
  'session.models',
  'session.selectModel',
  'skill.list',
  'command.list',
  'command.execute',
  'mobile.pending',
  'mobile.respond',
  'quota.read',
])

const ROOT = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(ROOT, 'public')

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

function readPublic(name, type) {
  return (_req, res) => {
    const body = readFileSync(join(PUBLIC, name))
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
    })
    res.end(body)
  }
}

function json(res, status, body, extra = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

async function readBody(req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > maxBytes) throw new Error('body too large')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  return JSON.parse(text)
}

async function fetchLoopbackJson(port, path, signal) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  const onAbort = () => ac.abort()
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      return { present: false, code: 'aborted' }
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'dsh-mobile-plus/quota' },
      signal: ac.signal,
    })
    if (res.status === 404) return { present: false, code: 'missing-plugin' }
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return { present: false, code: 'malformed' }
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { present: false, code: 'malformed' }
    }
    return { present: true, ...body }
  } catch {
    return { present: false, code: ac.signal.aborted ? 'timeout' : 'unavailable' }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

function hostnameOf(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return undefined
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return undefined
  }
}

function hostIsLoopback(req) {
  const hostname = hostnameOf(req)
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

function socketIsLoopback(req) {
  const addr = req.socket?.remoteAddress
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

/**
 * setup / pair/issue / stop / revoke, and the device list on status,
 * are for the host's own browser. SSH reverse tunnels make the socket
 * look like loopback while Host is the public name — require both.
 */
function isLoopback(req) {
  return hostIsLoopback(req) && socketIsLoopback(req)
}

function cookieValue(header, name) {
  if (typeof header !== 'string') return undefined
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === name) return rest.join('=')
  }
  return undefined
}

function normalizePublicBaseUrl(raw) {
  const trimmed = String(raw || '').trim().replace(/\/$/, '')
  if (trimmed === '') return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return trimmed
  } catch {
    return ''
  }
}

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function isHttps(req) {
  if (req.socket?.encrypted) return true
  const forwarded = req.headers['x-forwarded-proto']
  if (typeof forwarded !== 'string' || forwarded === '') return false
  return forwarded.split(',')[0].trim() === 'https'
}

function deviceCookie(id, row) {
  return typeof row?.secret === 'string' && row.secret !== '' ? row.secret : id
}

function deviceId() {
  return randomBytes(16).toString('hex')
}

function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/**
 * Phone directory browser needs `host.listDirectory` (kind: browse).
 * Desktop DSH on a loopback Mac/Windows bind composes the native OS
 * chooser instead, and apiproxy then rejects listDirectory. Mobile is
 * always remote, so we serve one listing ourselves (Node stdlib only —
 * this plugin is `link:`-installed and must not import @deepseek-ai/*).
 */
const DIR_MAX_ENTRIES = 1000

function fullyQualifiedPath(path, platform = process.platform) {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

function ancestryCrumbs(target) {
  const crumbs = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    crumbs.unshift({
      name: parent === current ? current : basename(current),
      path: current,
      hidden: false,
    })
    if (parent === current) return crumbs
    current = parent
  }
}

function failDirectory(code, path, message) {
  return { result: { ok: false, error: { code, message, details: { path } } } }
}

async function listHostDirectory(payload, signal) {
  const home = homedir()
  const requested = payload && typeof payload.path === 'string' ? payload.path : undefined
  if (requested !== undefined && !fullyQualifiedPath(requested)) {
    return failDirectory('directory-unreadable', requested, `cannot list "${requested}": not a fully qualified path`)
  }
  const target = resolve(requested ?? home)
  try {
    signal?.throwIfAborted()
    const dirents = await readdir(target, { withFileTypes: true })
    signal?.throwIfAborted()
    const candidates = dirents
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name))
    const entries = []
    let truncated = false
    for (const dirent of candidates) {
      signal?.throwIfAborted()
      if (entries.length >= DIR_MAX_ENTRIES) {
        truncated = true
        break
      }
      const child = join(target, dirent.name)
      let enterable = dirent.isDirectory()
      if (!enterable && dirent.isSymbolicLink()) {
        try {
          enterable = (await stat(child)).isDirectory()
        } catch {
          if (signal?.aborted) {
            const reason = signal.reason
            throw reason instanceof Error ? reason : new Error(String(reason))
          }
          continue
        }
      }
      if (!enterable) continue
      entries.push({ name: dirent.name, path: child, hidden: dirent.name.startsWith('.') })
    }
    return {
      result: {
        ok: true,
        value: {
          path: target,
          home,
          crumbs: ancestryCrumbs(target),
          entries,
          truncated,
        },
      },
    }
  } catch (error) {
    if (signal?.aborted) {
      return { result: { ok: false, error: { code: 'cancelled', message: 'directory listing was aborted', details: {} } } }
    }
    const message = error instanceof Error ? error.message : String(error)
    return failDirectory('directory-unreadable', target, `cannot list ${target}: ${message}`)
  }
}

/** Number of paired devices that are still inside the idle window (desktop status). */
function aliveDevices(devices) {
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

function loadDevices(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && raw.devices && typeof raw.devices === 'object') return raw.devices
  } catch {
    /* first run */
  }
  return {}
}

function saveDevices(file, devices) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, devices }, null, 2), { mode: 0o600 })
}

export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false
  if (!enabled) return

  const publicBaseUrl = normalizePublicBaseUrl(config.publicBaseUrl)
  const requirePairing = config.requirePairing !== false
  let publicHost = ''
  try {
    publicHost = publicBaseUrl === '' ? '' : new URL(publicBaseUrl).host
  } catch {
    publicHost = ''
  }
  const devicesFile = config.devicesFile || join(dshHome(), 'mobile-plus-devices.json')
  const devices = loadDevices(devicesFile)
  let token = undefined

  const persist = () => saveDevices(devicesFile, devices)

  const trustedHost = (req) => {
    if (isLoopback(req)) return true
    const host = req.headers.host
    return typeof host === 'string' && publicHost !== '' && host === publicHost
  }

  const findByCookie = (cookie) => {
    if (typeof cookie !== 'string' || cookie === '') return undefined
    for (const id of Object.keys(devices)) {
      const row = devices[id]
      if (sameSecret(deviceCookie(id, row), cookie)) return { id, row }
    }
    return undefined
  }

  const touch = (req) => {
    const found = findByCookie(cookieValue(req.headers.cookie, COOKIE))
    if (!found) return false
    if (Date.now() - found.row.lastSeenAt > IDLE_MS) {
      delete devices[found.id]
      persist()
      return false
    }
    found.row.lastSeenAt = Date.now()
    persist()
    return true
  }

  const setDeviceCookie = (resHeaders, secret, req) => {
    const parts = [
      `${COOKIE}=${secret}`,
      `Path=${PREFIX}`,
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${60 * 60 * 24 * 365}`,
    ]
    if (isHttps(req)) parts.push('Secure')
    resHeaders['set-cookie'] = parts.join('; ')
    return resHeaders
  }

  const handleSetup = (req, res) => {
    if (!isLoopback(req)) {
      res.writeHead(403)
      res.end('setup is loopback only')
      return
    }
    readPublic('setup.html', 'text/html; charset=utf-8')(req, res)
  }

  const handleApp = readPublic('app.html', 'text/html; charset=utf-8')
  const handleAppJs = readPublic('app.js', 'text/javascript; charset=utf-8')

  const handleIssue = async (req, res) => {
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
    token = { secret, expiresAt: Date.now() + TOKEN_TTL_MS, consumed: false }
    const localUrl = `http://127.0.0.1:${String(ctx.webServer.port)}${PREFIX}/?pair=${secret}`
    const url = publicBaseUrl === '' ? localUrl : `${publicBaseUrl}${PREFIX}/?pair=${secret}`
    json(res, 200, {
      ok: true,
      url,
      localUrl,
      qr: svgDataUri(makeQrSvg(url)),
      qrLocal: svgDataUri(makeQrSvg(localUrl)),
      expiresAt: token.expiresAt,
      publicBaseUrl,
    })
  }

  const handleAccept = async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!trustedHost(req)) {
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
      token
      && !token.consumed
      && Date.now() <= token.expiresAt
      && sameSecret(token.secret, offered),
    )
    if (!valid) {
      json(res, 404, { ok: false, code: 'invalid-token' })
      return
    }
    token.consumed = true
    const id = deviceId()
    const cookieSecret = deviceId()
    devices[id] = {
      secret: cookieSecret,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      label: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 180) : 'phone',
    }
    persist()
    json(res, 200, { ok: true, deviceId: id }, setDeviceCookie({}, cookieSecret, req))
  }

  const handleStatus = (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!trustedHost(req)) {
      json(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    const paired = requirePairing ? touch(req) : true
    if (!isLoopback(req)) {
      json(res, 200, {
        ok: true,
        paired,
        deviceCount: 0,
        onlineCount: 0,
        devices: [],
        publicBaseUrl,
      })
      return
    }
    const alive = aliveDevices(devices)
    if (alive.cleaned) persist()
    const now = Date.now()
    const rows = Object.entries(devices).map(([id, row]) => ({
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
      publicBaseUrl,
    })
  }

  /** Stop remote access: drop the active token and every paired device. */
  const handleStop = (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!isLoopback(req)) {
      json(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    token = undefined
    for (const id of Object.keys(devices)) delete devices[id]
    persist()
    json(res, 200, { ok: true })
  }

  /** Revoke one paired device from the desktop panel. */
  const handleRevoke = async (req, res) => {
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
    if (id === '' || !Object.prototype.hasOwnProperty.call(devices, id)) {
      json(res, 404, { ok: false, code: 'unknown-device' })
      return
    }
    delete devices[id]
    persist()
    json(res, 200, { ok: true })
  }

  const wrap = (rpcId, response) => ({
    type: 'server-response',
    rpcId,
    result: response.result,
  })

  function muxEnvelope(frame) {
    if (!frame || typeof frame !== 'object') return null
    if (frame.type === 'server-request' && frame.payload && typeof frame.payload === 'object') {
      return { rpcId: typeof frame.rpcId === 'string' ? frame.rpcId : '', payload: frame.payload }
    }
    if (typeof frame.type === 'string') {
      return { rpcId: typeof frame.rpcId === 'string' ? frame.rpcId : '', payload: frame }
    }
    return null
  }

  function createPendingTracker() {
    const sessions = new Map()
    const bucket = (sessionId) => {
      let row = sessions.get(sessionId)
      if (!row) {
        row = { approvals: new Map(), questions: new Map() }
        sessions.set(sessionId, row)
      }
      return row
    }
    return {
      onFrame(raw) {
        const env = muxEnvelope(raw)
        if (!env) return
        const payload = env.payload
        const sessionId = payload.sessionId
        if (typeof sessionId !== 'string') return
        if (payload.type === 'approval/requested') {
          bucket(sessionId).approvals.set(payload.approvalId, {
            rpcId: env.rpcId,
            approvalId: payload.approvalId,
            toolName: payload.toolName,
            callId: payload.callId,
            reason: payload.reason,
          })
        } else if (payload.type === 'approval/resolved') {
          sessions.get(sessionId)?.approvals.delete(payload.approvalId)
        } else if (payload.type === 'question/requested') {
          bucket(sessionId).questions.set(env.rpcId, {
            rpcId: env.rpcId,
            questions: Array.isArray(payload.questions) ? payload.questions : [],
          })
        } else if (payload.type === 'question/resolved') {
          sessions.get(sessionId)?.questions.delete(payload.questionRpcId)
        }
      },
      pending(sessionId) {
        const row = sessions.get(sessionId)
        if (!row) return { approvals: [], questions: [] }
        return {
          approvals: [...row.approvals.values()],
          questions: [...row.questions.values()],
        }
      },
      findApproval(sessionId, approvalId) {
        return sessions.get(sessionId)?.approvals.get(approvalId)
      },
      findQuestion(sessionId, rpcId) {
        return sessions.get(sessionId)?.questions.get(rpcId)
      },
    }
  }

  const pendingTracker = createPendingTracker()
  let quotaCache = { at: 0, value: null }
  const QUOTA_TTL_MS = 8_000

  async function readQuotaSnapshot(force, signal) {
    if (!force && quotaCache.value && Date.now() - quotaCache.at < QUOTA_TTL_MS) {
      return quotaCache.value
    }
    const port = ctx.webServer.port
    const [deepseek, grok] = await Promise.all([
      fetchLoopbackJson(port, '/dsh-deepseek-balance', signal),
      fetchLoopbackJson(port, '/dsh-grok-oauth/usage', signal),
    ])
    const value = { deepseek, grok }
    quotaCache = { at: Date.now(), value }
    return value
  }

  const sessionCwd = async (sessionId) => {
    try {
      const listed = await ctx.apiProxy.sessions.list({ rpcId: `mp-cwd-${Date.now()}`, payload: {} })
      if (listed.result?.ok) {
        const row = listed.result.value.items.find((item) => item.sessionId === sessionId)
        if (row?.cwd) return row.cwd
      }
    } catch { /* fall through */ }
    try {
      const workspaces = await ctx.apiProxy.workspace.list({ rpcId: `mp-ws-${Date.now()}`, payload: {} })
      if (workspaces.result?.ok && workspaces.result.value.items[0]?.path) {
        return workspaces.result.value.items[0].path
      }
    } catch { /* fall through */ }
    return undefined
  }

  const persistPhoneImages = async (payload) => {
    if (!payload || !Array.isArray(payload.content)) return payload
    const images = payload.content.filter((part) => part && part.type === 'image' && typeof part.data === 'string')
    if (images.length === 0) return payload
    const cwd = await sessionCwd(payload.sessionId)
    if (!cwd) return payload
    const dir = join(cwd, '.dsh-mobile-inbox')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const paths = []
    images.forEach((part, index) => {
      // 落盘写完整原图：手机端现在同时携带缩略图（data）与完整图（fullData）；
      // 老客户端只有 data 时原样处理（完整图即为 data，行为与之前一致）。
      const raw = typeof part.fullData === 'string' && part.fullData !== '' ? part.fullData : part.data
      const ext = part.mediaType === 'image/png' ? 'png' : part.mediaType === 'image/webp' ? 'webp' : part.mediaType === 'image/gif' ? 'gif' : 'jpg'
      const filePath = join(dir, `${stamp}-${index + 1}.${ext}`)
      writeFileSync(filePath, Buffer.from(raw, 'base64'))
      paths.push(filePath)
      if (index === images.length - 1) {
        writeFileSync(join(dir, `latest.${ext}`), Buffer.from(raw, 'base64'))
      }
    })
    const note = ['【手机发来的文件】', ...paths].join('\n')
    // 传给模型的内容只保留缩略图：剔除 fullData（完整 base64 不再进会话日志）。
    const rest = payload.content
      .filter((part) => !(part && part.type === 'text' && String(part.text || '').includes('【手机发来的')))
      .map((part) => {
        if (!part || part.type !== 'image' || typeof part.fullData !== 'string') return part
        const { fullData, ...slim } = part
        return slim
      })
    const texts = rest.filter((part) => part && part.type === 'text')
    const others = rest.filter((part) => !(part && part.type === 'text'))
    return {
      ...payload,
      content: [...texts, { type: 'text', text: note }, ...others],
    }
  }

  async function readRawBody(req, maxBytes) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > maxBytes) throw new Error('body too large')
      chunks.push(buf)
    }
    return Buffer.concat(chunks)
  }

  function decodeHeaderFilename(raw) {
    if (typeof raw !== 'string' || raw === '') return 'file'
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }

  function safeBasename(raw) {
    let base = basename(String(raw || '').replace(/\\/g, '/'))
    base = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\]/g, '')
    if (base === '' || base === '.' || base === '..') base = 'file'
    if (base.length > 120) {
      const ext = extname(base)
      const keep = Math.max(1, 120 - ext.length)
      base = `${base.slice(0, keep)}${ext}`
    }
    return base
  }

  function uniquePath(filePath) {
    if (!existsSync(filePath)) return filePath
    const ext = extname(filePath)
    const stem = ext ? filePath.slice(0, -ext.length) : filePath
    for (let i = 2; i < 100; i += 1) {
      const next = `${stem}-${i}${ext}`
      if (!existsSync(next)) return next
    }
    return `${stem}-${Date.now()}${ext}`
  }

  function sipsToJpeg(srcPath, destPath) {
    return new Promise((resolve) => {
      execFile('sips', ['-s', 'format', 'jpeg', srcPath, '--out', destPath], { timeout: 20_000 }, (error) => {
        resolve(!error && existsSync(destPath))
      })
    })
  }

  async function handleUpload(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (requirePairing && !touch(req)) {
      json(res, 403, { ok: false, error: { code: 'unpaired', message: 'not paired' } })
      return
    }
    const sessionId = typeof req.headers['x-mp-session-id'] === 'string' ? req.headers['x-mp-session-id'].trim() : ''
    if (sessionId === '') {
      json(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing sessionId' } })
      return
    }
    const cwd = await sessionCwd(sessionId)
    if (!cwd) {
      json(res, 400, { ok: false, error: { code: 'bad-request', message: '找不到会话工作区' } })
      return
    }
    let buf
    try {
      buf = await readRawBody(req, MAX_UPLOAD_BYTES)
    } catch {
      json(res, 400, { ok: false, error: { code: 'too-large', message: '文件不能超过 20MB' } })
      return
    }
    if (buf.length === 0) {
      json(res, 400, { ok: false, error: { code: 'bad-request', message: '空文件' } })
      return
    }
    const rawName = decodeHeaderFilename(req.headers['x-mp-filename'])
    const mediaType = typeof req.headers['x-mp-media-type'] === 'string'
      ? req.headers['x-mp-media-type'].slice(0, 120)
      : ''
    const dir = join(cwd, '.dsh-mobile-inbox')
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    let dest = uniquePath(join(dir, `${stamp}-${safeBasename(rawName)}`))
    await writeFile(dest, buf)
    const looksHeic = /\.(heic|heif)$/i.test(dest) || /image\/hei[cf]/i.test(mediaType)
    if (looksHeic) {
      const converted = uniquePath(dest.replace(/\.(heic|heif)$/i, '.jpg'))
      const ok = await sipsToJpeg(dest, converted)
      if (ok) {
        await rm(dest, { force: true })
        dest = converted
      }
    }
    let bytes = buf.length
    try {
      bytes = (await stat(dest)).size
    } catch { /* keep buf.length */ }
    json(res, 200, {
      type: 'server-response',
      result: { ok: true, value: { path: dest, name: basename(dest), bytes } },
    })
  }

  const THUMB_MAX_BYTES = 40 * 1024 // 超过即视为"全图"（新缩略图 ~25KB，不处理）

  /** 判断一个 image part 是否内嵌 base64 数据。 */
  function inlineImageData(part) {
    if (!part || part.type !== 'image' || typeof part.data !== 'string' || part.data === '') return undefined
    if (part.data.startsWith('data:')) {
      const comma = part.data.indexOf(',')
      const header = part.data.slice(0, comma)
      const mime = /^data:image\/([a-z0-9+]+)/i.exec(header)?.[1]?.toLowerCase() ?? 'jpeg'
      const b64 = comma === -1 ? '' : part.data.slice(comma + 1)
      if (b64 === '') return undefined
      return { b64, mime }
    }
    return { b64: part.data, mime: (part.mediaType || 'image/jpeg').replace('image/', '').toLowerCase() }
  }

  /**
   * 读取时懒瘦身：把历史里超过阈值的全图 base64 换成 320px JPEG 缩略图
   * （macOS 自带 sips 生成，命中缓存直接读）。首次生成会写缓存目录
   * <cwd>/.dsh-mobile-inbox/.thumbs/。任何一步失败都原样返回（降级无害）。
   * 手机 UI 因此只收 ~25KB/张；模型侧不受影响（它走 prompt/日志原图）。
   *
   * sips 通过 execFile 异步调用，不阻塞事件循环：生成期间其他请求
   * （桌面 Web UI 等）照常得到响应。
   */
  function sipsThumbnail(srcPath, thumbPath) {
    return new Promise((resolve) => {
      execFile('sips', ['-Z', '320', '-s', 'format', 'jpeg', srcPath, '--out', thumbPath], { timeout: 10_000 }, (error) => {
        resolve({ status: error ? 1 : 0 })
      })
    })
  }

  async function slimHistoryImages(events, cwd) {
    if (!Array.isArray(events) || cwd === undefined) return events
    const cacheDir = join(cwd, '.dsh-mobile-inbox', '.thumbs')
    const changed = []
    let changedAny = false
    for (const entry of events) {
      const ev = entry && (entry.event || entry)
      const data = ev && ev.data
      if (!ev || typeof ev !== 'object' || !data || !Array.isArray(data.content)) {
        changed.push(entry)
        continue
      }
      let contentChanged = false
      const content = []
      for (const part of data.content) {
        const info = inlineImageData(part)
        if (info === undefined || info.b64.length < THUMB_MAX_BYTES) {
          content.push(part)
          continue
        }
        const key = createHash('sha1').update(`image/${info.mime}:${info.b64}`).digest('hex')
        const thumbPath = join(cacheDir, `${key}.jpg`)
        try {
          if (!existsSync(thumbPath)) {
            await mkdir(cacheDir, { recursive: true })
            const srcPath = join(cacheDir, `tmp-${key}.${info.mime === 'png' ? 'png' : 'jpg'}`)
            await writeFile(srcPath, Buffer.from(info.b64, 'base64'))
            const res = await sipsThumbnail(srcPath, thumbPath)
            await rm(srcPath, { force: true })
            if (res.status !== 0 || !existsSync(thumbPath)) {
              content.push(part)
              continue
            }
          }
          contentChanged = true
          const thumbB64 = (await readFile(thumbPath)).toString('base64')
          content.push({ type: 'image', mediaType: 'image/jpeg', data: thumbB64, name: part.name })
        } catch {
          content.push(part)
        }
      }
      changedAny = changedAny || contentChanged
      changed.push(contentChanged ? { ...entry, event: { ...ev, data: { ...data, content } } } : entry)
    }
    return changedAny ? changed : events
  }

  /** Runtime shape guard for lossless-JSON event payloads. */
  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  /**
   * 历史快照化裁剪 —— 老插件主机端没做到、但文档承诺过的
   * "按整条消息分页"（它对 apiProxy.sessions.history 直接透传，手机拿到的是
   * 全量原始事件流，长会话动辄数 MB、几万条 chunk）。这里补上：
   * 1. 丢弃所有 assistant/chunk（流式块），把 text/reasoning 累积回对应的
   *    assistant/message 的 content（最终消息即权威快照；UI 只在这条里取全文）
   * 2. 只保留最近 maxMessages 条"消息事件"（user/message | assistant/message）
   *    所在窗口；窗口内其它非 chunk 事件（tool/call、turn/start…）全保留
   * 3. hasMore = 窗口左侧仍有消息事件（loadOlder 用 beforeSeq 精确续页）
   * 实时流式由 SSE mux 原生提供，不受影响。
   */
  function foldHistoryForMobile(entries, maxMessages) {
    const norm = (entries || []).map((entry, idx) => {
      const ev = entry && (entry.event || entry)
      return { entry, ev, seq: typeof ev?.seq === 'number' ? ev.seq : idx }
    }).sort((a, b) => a.seq - b.seq)

    const MESSAGE = new Set(['user/message', 'assistant/message'])
    const messageRows = norm.filter(({ ev }) => ev && MESSAGE.has(ev.type))
    const keepFrom = messageRows.length <= maxMessages
      ? 0
      : messageRows[messageRows.length - maxMessages].seq

    // 先把 chunk 文本按 (turn, step) 累积
    const acc = new Map()
    for (const { ev } of norm) {
      if (!ev || ev.type !== 'assistant/chunk') continue
      const data = isRecord(ev.data) ? ev.data : {}
      const chunk = isRecord(data.chunk) ? data.chunk : {}
      if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') continue
      const key = `${data.turn ?? 0}.${data.step ?? 0}`
      const cur = acc.get(key) || { text: '', reasoning: '' }
      const piece = typeof chunk.text === 'string' ? chunk.text : ''
      if (chunk.type === 'reasoning-delta') cur.reasoning += piece
      else cur.text += piece
      acc.set(key, cur)
    }

    // 输出窗口内非 chunk 事件；assistant/message 并入累积文本。
    // UI 不渲染的元数据事件（request/header、tool/result、llm-request 回执）
    // 一并剔除——正是它们让历史又大又没用。
    const DROP = new Set(['assistant/chunk', 'request/header', 'tool/result', 'web/deepseek-search-llm-request', 'session/title-llm-request'])
    const events = []
    for (const { entry, ev, seq } of norm) {
      if (seq < keepFrom) continue
      if (!ev || DROP.has(ev.type)) continue
      if (ev.type === 'assistant/message') {
        const data = isRecord(ev.data) ? ev.data : {}
        const message = isRecord(data.message) ? data.message : data
        const merged = mergeChunkIntoMessage(message, acc.get(`${data.turn ?? 0}.${data.step ?? 0}`))
        events.push({ event: { ...ev, data: isRecord(data.message) ? { ...data, message: merged } : merged } })
        continue
      }
      events.push(entry)
    }
    return { events, hasMore: messageRows.length > maxMessages }
  }

  /** 把累积的 chunk 文本并入最终消息（缺 text/reasoning block 时补上）。 */
  function mergeChunkIntoMessage(message, chunked) {
    const content = Array.isArray(message.content) ? message.content.map((b) => b) : []
    const hasText = content.some((b) => b && b.type === 'text')
    const hasReasoning = content.some((b) => b && b.type === 'reasoning')
    if (chunked && chunked.text !== '' && !hasText) content.unshift({ type: 'text', text: chunked.text })
    if (chunked && chunked.reasoning !== '' && !hasReasoning) content.push({ type: 'reasoning', text: chunked.reasoning })
    return { ...message, content }
  }

  const SESSION_PAGE = 20

  function sessionCursor(row) {
    return `${row.updatedAt}:${row.sessionId}`
  }

  function paginateSessions(items, cursor) {
    const start = cursor
      ? Math.max(0, items.findIndex((row) => sessionCursor(row) === cursor) + 1)
      : 0
    const page = items.slice(start, start + SESSION_PAGE)
    const last = page[page.length - 1]
    const nextCursor = last && start + page.length < items.length ? sessionCursor(last) : undefined
    return { items: page, hasMore: Boolean(nextCursor), nextCursor }
  }

  /**
   * 先按工作区裁剪再分页。全局 20 条里属于当前工作区的可能是 0～几条，
   * 不裁的话手机端会一直显示「加载更多 / 加载中」却加不出一行。
   */
  async function sessionsForWorkspace(items, workspaceId) {
    if (!workspaceId) return items
    try {
      const listed = await ctx.apiProxy.workspace.list({ rpcId: `mp-ws-filter-${Date.now()}`, payload: {} })
      if (!listed.result?.ok) return items
      const ws = (listed.result.value.items || []).find((row) => row.workspaceId === workspaceId)
      const owned = new Set(ws?.sessionIds || [])
      return items.filter((row) => owned.has(row.sessionId))
    } catch {
      return items
    }
  }

  const dispatch = async (method, payload, rpcId, signal) => {
    const api = ctx.apiProxy
    if (method === 'workspace.list') return wrap(rpcId, await api.workspace.list({ rpcId, payload }))
    if (method === 'workspace.create') return wrap(rpcId, await api.workspace.create({ rpcId, payload }))
    if (method === 'host.listDirectory') {
      try {
        const viaHost = await api.host.listDirectory({ rpcId, payload }, signal)
        if (viaHost.result?.ok) return wrap(rpcId, viaHost)
        if (viaHost.result?.error?.code !== 'directory-picker-unavailable') return wrap(rpcId, viaHost)
      } catch {
        /* native picker, missing method — fall through to local listing */
      }
      return wrap(rpcId, await listHostDirectory(payload, signal))
    }
    if (method === 'agentPreset.list') return wrap(rpcId, await api.agentPresets.list({ rpcId, payload }))
    if (method === 'session.create') return wrap(rpcId, await api.sessions.create({ rpcId, payload }))
    if (method === 'session.history') {
      const full = await api.sessions.history({ rpcId, payload })
      if (full.result?.ok) {
        const max = Number.isFinite(payload?.maxMessages) ? payload.maxMessages : 30
        const folded = foldHistoryForMobile(full.result.value.events, max)
        const cwd = await sessionCwd(payload?.sessionId)
        folded.events = await slimHistoryImages(folded.events, cwd)
        full.result.value.events = folded.events
        full.result.value.hasMore = folded.hasMore
      }
      return wrap(rpcId, full)
    }
    if (method === 'session.prompt') {
      const next = await persistPhoneImages(payload)
      return wrap(rpcId, await api.sessions.prompt({ rpcId, payload: next }))
    }
    if (method === 'session.cancel') return wrap(rpcId, await api.sessions.cancel({ rpcId, payload }))
    if (method === 'session.attachment') return wrap(rpcId, await api.sessions.attachment({ rpcId, payload }))
    if (method === 'session.models') return wrap(rpcId, await api.sessions.models({ rpcId, payload }))
    if (method === 'session.selectModel') return wrap(rpcId, await api.sessions.selectModel({ rpcId, payload }))
    if (method === 'mobile.pending') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      return { type: 'server-response', rpcId, result: { ok: true, value: pendingTracker.pending(sessionId) } }
    }
    if (method === 'mobile.respond') {
      if (typeof api.respond !== 'function') {
        return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'unavailable', message: 'respond 不可用' } } }
      }
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const kind = payload && payload.type
      let targetRpcId = typeof payload?.rpcId === 'string' ? payload.rpcId : ''
      let value
      if (kind === 'approval') {
        const approvalId = payload.approvalId
        const found = pendingTracker.findApproval(sessionId, approvalId)
        if (found?.rpcId) targetRpcId = found.rpcId
        value = { sessionId, approvalId, outcome: payload.outcome }
      } else if (kind === 'question') {
        const found = pendingTracker.findQuestion(sessionId, targetRpcId)
        if (!found && pendingTracker.pending(sessionId).questions[0]) {
          targetRpcId = pendingTracker.pending(sessionId).questions[0].rpcId
        }
        value = { sessionId, answer: { answers: Array.isArray(payload.answers) ? payload.answers : [] } }
      } else {
        return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'bad-request', message: 'unknown respond type' } } }
      }
      if (!targetRpcId) {
        return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'not-pending', message: '没有待处理的审批或提问' } } }
      }
      const receipt = await api.respond({
        type: 'client-response',
        rpcId: targetRpcId,
        result: { ok: true, value },
      })
      return wrap(rpcId, { result: { ok: true, value: receipt } })
    }
    if (method === 'skill.list') return wrap(rpcId, await api.skills.list({ rpcId, payload }))
    if (method === 'command.list') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const agent = sessionId && ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(sessionId) : undefined
      if (!agent || !ctx.commands || typeof ctx.commands.list !== 'function') {
        return { type: 'server-response', rpcId, result: { ok: true, value: { items: [] } } }
      }
      const items = ctx.commands.list(agent).map((row) => ({
        name: row.name,
        description: row.description,
        hint: row.input && typeof row.input.hint === 'string' ? row.input.hint : undefined,
      }))
      return { type: 'server-response', rpcId, result: { ok: true, value: { items } } }
    }
    if (method === 'command.execute') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const line = payload && typeof payload.line === 'string' ? payload.line : ''
      const agent = sessionId && ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(sessionId) : undefined
      if (!agent || !ctx.commands || typeof ctx.commands.execute !== 'function') {
        return {
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'unavailable', message: '宿主命令服务不可用' } },
        }
      }
      const execution = await ctx.commands.execute(agent, line, [], signal)
      if (execution === undefined) {
        return {
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'unknown-command', message: '未知命令' } },
        }
      }
      return { type: 'server-response', rpcId, result: { ok: true, value: { matched: true, result: execution.result } } }
    }
    if (method === 'quota.read') {
      const force = payload && payload.force === true
      const value = await readQuotaSnapshot(force, signal)
      return { type: 'server-response', rpcId, result: { ok: true, value } }
    }
    if (method === 'session.list') {
      const full = await api.sessions.list({ rpcId, payload })
      if (!full.result.ok) return wrap(rpcId, full)
      const workspaceId = payload && typeof payload.workspaceId === 'string' ? payload.workspaceId : ''
      const sorted = [...full.result.value.items].sort((a, b) => b.updatedAt - a.updatedAt)
      const items = await sessionsForWorkspace(sorted, workspaceId)
      const cursor = payload && typeof payload.cursor === 'string' ? payload.cursor : undefined
      const page = paginateSessions(items, cursor)
      return {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: page },
      }
    }
    throw new Error(`unhandled ${method}`)
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
      await handleUpload(req, res)
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (requirePairing && !touch(req)) {
      json(res, 403, { ok: false, error: { code: 'unpaired', message: 'not paired' } })
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

  /**
   * Shared SSE writer for mux (chat events) and host (session running /
   * workspace membership). Phone relays otherwise buffer for seconds.
   */
  async function pipeSse(req, res, openFrames) {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    if (requirePairing && !touch(req)) {
      json(res, 403, { ok: false, error: { code: 'unpaired' } })
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const controller = new AbortController()
    let closed = false
    const ping = setInterval(() => {
      touch(req)
      try { res.write(': ping\n\n') } catch { /* ignore */ }
    }, 15_000)
    const onClose = () => {
      if (closed) return
      closed = true
      controller.abort()
      clearInterval(ping)
    }
    res.on('close', onClose)
    req.on('close', onClose)
    try {
      const frames = openFrames(controller.signal)
      for await (const frame of frames) {
        if (closed) break
        pendingTracker.onFrame(frame)
        res.write(`data: ${JSON.stringify(frame)}\n\n`)
      }
    } catch {
      /* EventSource reconnects */
    } finally {
      onClose()
    }
    if (!closed) res.end()
  }

  const handleEvents = async (req, res) => {
    await pipeSse(req, res, (signal) => ctx.apiProxy.events.mux(
      { rpcId: `mp-mux-${Date.now().toString(36)}`, payload: {} },
      signal,
    ))
  }

  const handleHostEvents = async (req, res) => {
    if (!ctx.apiProxy.events || typeof ctx.apiProxy.events.host !== 'function') {
      json(res, 404, { ok: false, error: { code: 'unavailable', message: 'host events unsupported' } })
      return
    }
    await pipeSse(req, res, (signal) => ctx.apiProxy.events.host(
      { rpcId: `mp-host-${Date.now().toString(36)}`, payload: {} },
      signal,
    ))
  }

  ctx.effect(() => {
    const routes = [
      { kind: 'exact', path: `${PREFIX}/setup`, handler: handleSetup },
      { kind: 'exact', path: PREFIX, handler: handleApp },
      { kind: 'exact', path: `${PREFIX}/`, handler: handleApp },
      { kind: 'exact', path: `${PREFIX}/app.js`, handler: handleAppJs },
      { kind: 'exact', path: `${PREFIX}/logo.svg`, handler: readPublic('logo.svg', 'image/svg+xml; charset=utf-8') },
      { kind: 'exact', path: `${PREFIX}/manifest.webmanifest`, handler: readPublic('manifest.webmanifest', 'application/manifest+json; charset=utf-8') },
      { kind: 'exact', path: `${PREFIX}/offline.html`, handler: readPublic('offline.html', 'text/html; charset=utf-8') },
      { kind: 'exact', path: `${PREFIX}/sw.js`, handler: (_req, res) => {
        const body = readFileSync(join(PUBLIC, 'sw.js'))
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'service-worker-allowed': `${PREFIX}/`,
        })
        res.end(body)
      } },
      { kind: 'exact', path: `${PREFIX}/icon-192.png`, handler: readPublic('icon-192.png', 'image/png') },
      { kind: 'exact', path: `${PREFIX}/icon-512.png`, handler: readPublic('icon-512.png', 'image/png') },
      { kind: 'exact', path: `${PREFIX}/apple-touch-icon.png`, handler: readPublic('apple-touch-icon.png', 'image/png') },
      { kind: 'exact', path: `${PREFIX}/pair/issue`, handler: handleIssue },
      { kind: 'exact', path: `${PREFIX}/pair/accept`, handler: handleAccept },
      { kind: 'exact', path: `${PREFIX}/pair/status`, handler: handleStatus },
      { kind: 'exact', path: `${PREFIX}/pair/stop`, handler: handleStop },
      { kind: 'exact', path: `${PREFIX}/pair/revoke`, handler: handleRevoke },
      { kind: 'exact', path: `${PREFIX}/api/events.mux`, handler: handleEvents },
      { kind: 'exact', path: `${PREFIX}/api/events.host`, handler: handleHostEvents },
      { kind: 'prefix', path: `${PREFIX}/api`, handler: handleApi },
    ]
    const stop = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of stop) dispose() }
  }, 'dsh-mobile-plus: routes')

  ctx.effect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const frames = ctx.apiProxy.events.mux(
          { rpcId: `mp-pending-${Date.now().toString(36)}`, payload: {} },
          controller.signal,
        )
        for await (const frame of frames) pendingTracker.onFrame(frame)
      } catch {
        /* aborted or stream ended */
      }
    })()
    return () => controller.abort()
  }, 'dsh-mobile-plus: pending mux')
}
