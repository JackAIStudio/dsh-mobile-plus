/**
 * dsh-mobile-plus — independent mobile remote with text + image prompts.
 * Own routes under /mp. Does not patch @linxin666/dsh-remote-web-ui.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeQrSvg } from './qrcodegen.js'

export const name = 'dsh-mobile-plus'
export const inject = ['webServer', 'apiProxy']

const PREFIX = '/mp'
const COOKIE = 'mp_device'
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000
const IDLE_MS = 7 * 24 * 60 * 60 * 1000
/** A paired device counts as offline after this long without a touch. */
const OFFLINE_MS = 90 * 1000
const MAX_BODY = 12 * 1024 * 1024
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

function hostnameOf(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return undefined
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return undefined
  }
}

function isLoopback(req) {
  const hostname = hostnameOf(req)
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return true
  const addr = req.socket?.remoteAddress
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function cookieValue(header, name) {
  if (typeof header !== 'string') return undefined
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === name) return rest.join('=')
  }
  return undefined
}

function deviceId() {
  return randomBytes(16).toString('hex')
}

function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
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

  const publicBaseUrl = String(config.publicBaseUrl || 'http://your-relay-host').replace(/\/$/, '')
  let publicHost = ''
  try {
    publicHost = new URL(publicBaseUrl).host
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

  const hasDevice = (id) => {
    const row = devices[id]
    if (!row) return false
    if (Date.now() - row.lastSeenAt > IDLE_MS) {
      delete devices[id]
      persist()
      return false
    }
    return true
  }

  const touch = (req) => {
    const id = cookieValue(req.headers.cookie, COOKIE)
    if (id === undefined || !hasDevice(id)) return false
    devices[id].lastSeenAt = Date.now()
    persist()
    return true
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
    const url = `${publicBaseUrl}${PREFIX}/?pair=${secret}`
    const localUrl = `http://127.0.0.1:${String(ctx.webServer.port)}${PREFIX}/?pair=${secret}`
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
    if (!token || token.consumed || token.secret !== offered || Date.now() > token.expiresAt) {
      json(res, 404, { ok: false, code: 'invalid-token' })
      return
    }
    token.consumed = true
    const id = deviceId()
    devices[id] = {
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      label: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 180) : 'phone',
    }
    persist()
    json(res, 200, { ok: true, deviceId: id }, {
      'set-cookie': `${COOKIE}=${id}; Path=${PREFIX}; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`,
    })
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
      paired: touch(req),
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
    const note = [
      '【手机发来的图片】请立刻用 read_image 工具读取下面的本地路径，不要说看不到图。最新一张是最后一行。',
      ...paths.map((p) => p),
      '（会话内容里附带的图片是缩略图，请以 read_image 读取的本地原图为准进行识别。）',
    ].join('\n')
    // 传给模型的内容只保留缩略图：剔除 fullData（完整 base64 不再进会话日志，
    // 历史传输从每张 ~530KB 降到 ~25KB，打开会话/轮询回落显著变快）。
    const rest = payload.content
      .filter((part) => !(part && part.type === 'text' && String(part.text || '').includes('【手机发来的图片】')))
      .map((part) => {
        if (!part || part.type !== 'image' || typeof part.fullData !== 'string') return part
        const { fullData, ...slim } = part
        return slim
      })
    return {
      ...payload,
      content: [{ type: 'text', text: note }, ...rest],
    }
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

  const dispatch = async (method, payload, rpcId, signal) => {
    const api = ctx.apiProxy
    if (method === 'workspace.list') return wrap(rpcId, await api.workspace.list({ rpcId, payload }))
    if (method === 'workspace.create') return wrap(rpcId, await api.workspace.create({ rpcId, payload }))
    if (method === 'host.listDirectory') return wrap(rpcId, await api.host.listDirectory({ rpcId, payload }))
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
    if (method === 'session.list') {
      const full = await api.sessions.list({ rpcId, payload })
      if (!full.result.ok) return wrap(rpcId, full)
      const items = [...full.result.value.items].sort((a, b) => b.updatedAt - a.updatedAt)
      const cursor = payload && typeof payload.cursor === 'string' ? payload.cursor : undefined
      const start = cursor ? Math.max(0, items.findIndex((row) => `${row.updatedAt}:${row.sessionId}` === cursor) + 1) : 0
      const page = items.slice(start, start + 20)
      const last = page[page.length - 1]
      const nextCursor = last && start + page.length < items.length ? `${last.updatedAt}:${last.sessionId}` : undefined
      return {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { items: page, hasMore: Boolean(nextCursor), nextCursor } },
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
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!touch(req)) {
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

  const handleEvents = async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!touch(req)) {
      json(res, 403, { ok: false, error: { code: 'unpaired' } })
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
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
      const frames = ctx.apiProxy.events.mux(
        { rpcId: `mp-mux-${Date.now().toString(36)}`, payload: {} },
        controller.signal,
      )
      for await (const frame of frames) {
        if (closed) break
        res.write(`data: ${JSON.stringify(frame)}\n\n`)
      }
    } catch {
      /* EventSource reconnects */
    } finally {
      onClose()
    }
    if (!closed) res.end()
  }

  ctx.effect(() => {
    const routes = [
      { kind: 'exact', path: `${PREFIX}/setup`, handler: handleSetup },
      { kind: 'exact', path: PREFIX, handler: handleApp },
      { kind: 'exact', path: `${PREFIX}/`, handler: handleApp },
      { kind: 'exact', path: `${PREFIX}/app.js`, handler: handleAppJs },
      { kind: 'exact', path: `${PREFIX}/logo.svg`, handler: readPublic('logo.svg', 'image/svg+xml; charset=utf-8') },
      { kind: 'exact', path: `${PREFIX}/pair/issue`, handler: handleIssue },
      { kind: 'exact', path: `${PREFIX}/pair/accept`, handler: handleAccept },
      { kind: 'exact', path: `${PREFIX}/pair/status`, handler: handleStatus },
      { kind: 'exact', path: `${PREFIX}/pair/stop`, handler: handleStop },
      { kind: 'exact', path: `${PREFIX}/pair/revoke`, handler: handleRevoke },
      { kind: 'exact', path: `${PREFIX}/api/events.mux`, handler: handleEvents },
      { kind: 'prefix', path: `${PREFIX}/api`, handler: handleApi },
    ]
    const stop = routes.map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of stop) dispose() }
  }, 'dsh-mobile-plus: routes')
}
