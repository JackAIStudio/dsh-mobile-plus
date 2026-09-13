import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from './constants.js'

export const PIN_DOCUMENT_VERSION = 1
export const MAX_PINNED_SESSIONS = 40

export function resolvePinsPath() {
  return join(dshHome(), 'session-navigator', 'pins.json')
}

export function normalizePinDocument(raw) {
  const listed = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? raw.pins : [])
  const source = Array.isArray(listed) ? listed : []
  const pins = []
  const seen = new Set()
  for (const item of source) {
    if (!item) continue
    const sessionId = typeof item === 'string' ? item : (item.sessionId || item.id)
    if (typeof sessionId !== 'string' || !sessionId.trim()) continue
    const id = sessionId.trim().toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    const pinnedAt = Number(item.pinnedAt)
    pins.push({
      sessionId: id,
      pinnedAt: Number.isFinite(pinnedAt) && pinnedAt > 0 ? pinnedAt : 0,
    })
    if (pins.length >= MAX_PINNED_SESSIONS) break
  }
  return { version: PIN_DOCUMENT_VERSION, pins }
}

export async function readPinsFromFile(filePath = resolvePinsPath()) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return normalizePinDocument(JSON.parse(raw))
  } catch {
    return normalizePinDocument(null)
  }
}

export async function writePinsToFile(filePath, document) {
  const normalized = normalizePinDocument(document)
  const json = `${JSON.stringify(normalized, null, 2)}\n`
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, json, 'utf8')
  try {
    await rename(tmp, filePath)
  } catch (error) {
    if (process.platform === 'win32') {
      await writeFile(filePath, json, 'utf8')
      await unlink(tmp).catch(() => {})
      return normalized
    }
    await unlink(tmp).catch(() => {})
    throw error
  }
  return normalized
}

async function fetchHostPins(port, signal) {
  if (!port) return null
  try {
    const res = await fetch(`http://127.0.0.1:${port}/dsh-session-navigator/pins`, {
      signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.ok && data.document) {
      return normalizePinDocument(data.document)
    }
  } catch {
    // host route unavailable or timeout
  }
  return null
}

async function postHostPin(port, sessionId, pinned, signal) {
  if (!port) return null
  try {
    const res = await fetch(`http://127.0.0.1:${port}/dsh-session-navigator/pin`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sessionId, pinned }),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.ok && data.document) {
      return { ok: true, document: normalizePinDocument(data.document), pinned: data.pinned }
    }
  } catch {
    // host route unavailable or timeout
  }
  return null
}

export async function getPinsDocument(ctx, signal) {
  const port = ctx.webServer?.port
  const hostDoc = await fetchHostPins(port, signal)
  if (hostDoc) return hostDoc
  return readPinsFromFile()
}

export async function setPinDocument(ctx, sessionId, pinned, signal) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('invalid sessionId')
  }
  const id = sessionId.trim().toLowerCase()
  const port = ctx.webServer?.port
  const hostResult = await postHostPin(port, id, pinned, signal)
  if (hostResult) return hostResult

  const current = await readPinsFromFile()
  const nextPins = current.pins.filter((item) => item.sessionId !== id)
  if (pinned) {
    nextPins.unshift({ sessionId: id, pinnedAt: Date.now() })
    if (nextPins.length > MAX_PINNED_SESSIONS) nextPins.length = MAX_PINNED_SESSIONS
  }
  const document = await writePinsToFile(resolvePinsPath(), { version: PIN_DOCUMENT_VERSION, pins: nextPins })
  return { ok: true, document, pinned: Boolean(pinned) }
}

export async function handleGetPins(ctx, rpcId, signal) {
  try {
    const document = await getPinsDocument(ctx, signal)
    return {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: document },
    }
  } catch (err) {
    return {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'pins-error', message: err.message || String(err) } },
    }
  }
}

export async function handleSetPin(ctx, payload, rpcId, signal) {
  try {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : ''
    const pinned = Boolean(payload?.pinned)
    const result = await setPinDocument(ctx, sessionId, pinned, signal)
    return {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: result },
    }
  } catch (err) {
    return {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'pins-error', message: err.message || String(err) } },
    }
  }
}
