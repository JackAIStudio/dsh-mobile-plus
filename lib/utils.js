import { timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'

export function json(res, status, body, extra = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

export async function readBody(req, maxBytes) {
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

export async function readRawBody(req, maxBytes) {
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

export async function fetchLoopbackJson(port, path, signal) {
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

export function hostnameOf(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return undefined
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return undefined
  }
}

export function hostIsLoopback(req) {
  const hostname = hostnameOf(req)
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

export function socketIsLoopback(req) {
  const addr = req.socket?.remoteAddress
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

export function isLoopback(req) {
  return hostIsLoopback(req) && socketIsLoopback(req)
}

export function cookieValue(header, name) {
  if (typeof header !== 'string') return undefined
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === name) return rest.join('=')
  }
  return undefined
}

export function normalizePublicBaseUrl(raw) {
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

export function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function isHttps(req) {
  if (req.socket?.encrypted) return true
  const forwarded = req.headers['x-forwarded-proto']
  if (typeof forwarded !== 'string' || forwarded === '') return false
  return forwarded.split(',')[0].trim() === 'https'
}

export function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getLanIps() {
  const nets = networkInterfaces()
  const ips = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = typeof net.family === 'string' ? net.family : (net.family === 4 ? 'IPv4' : '')
      if (family === 'IPv4' && !net.internal) {
        ips.push(net.address)
      }
    }
  }
  return ips
}

export function isLanHost(req, lanIps = getLanIps()) {
  const hostname = hostnameOf(req)
  if (!hostname) return false
  return lanIps.includes(hostname)
}

export const wrap = (rpcId, response) => ({
  type: 'server-response',
  rpcId,
  result: response.result,
})
