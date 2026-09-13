/**
 * Pairing and authorization status.
 */
import { call } from './rpc.js'

export function parsePairInput(value) {
    const trimmed = (value || '').trim()
    if (trimmed === '') return undefined
    const digitsOnly = trimmed.replace(/[\s-]+/g, '')
    if (/^\d{6}$/.test(digitsOnly)) return digitsOnly
    try {
      const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost'
      const url = new URL(trimmed, base)
      const token = url.searchParams.get('pair')
      if (token) return token
    } catch {
      /* raw token or relative query */
    }
    if (/^[a-f0-9]{32}$/i.test(trimmed)) return trimmed
    return undefined
  }

export async function acceptPair(token) {
    const res = await fetch('/mp/pair/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token }),
    })
    if (res.ok) return undefined
    if (res.status === 404) return '配对码或链接无效，或已过期。'
    if (res.status === 409) return '配对码或链接已被使用。'
    return '此设备无法完成配对。'
  }

export function cleanPairUrl() {
  if (typeof window === 'undefined' || !window.location) return
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.has('pair')) {
      url.searchParams.delete('pair')
      const next = `${url.pathname}${url.search}${url.hash}`
      window.history.replaceState(window.history.state, '', next)
    }
  } catch {}
}

/**
 * Check host pair status with offline/network-error discrimination.
 * DSH server restart or gateway 502/504 must never be misjudged as 'unpaired'.
 */
export async function checkPairStatus(timeoutMs = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('/mp/pair/status', {
      credentials: 'same-origin',
      signal: controller.signal,
    })
    if (res.status >= 500 || res.status === 404) {
      return { ok: false, offline: true, status: res.status }
    }
    if (!res.ok) {
      return { ok: false, offline: false, status: res.status }
    }
    const data = await res.json()
    return { ok: true, paired: data?.paired === true, data }
  } catch (err) {
    return { ok: false, offline: true, error: err }
  } finally {
    clearTimeout(timer)
  }
}

export async function pairStatus() {
  const result = await checkPairStatus()
  return result.ok === true && result.paired === true
}

export async function pollUntilOnline(maxSeconds = 25) {
  const start = Date.now()
  while ((Date.now() - start) < maxSeconds * 1000) {
    await new Promise((r) => setTimeout(r, 1200))
    const check = await checkPairStatus(2500)
    if (!check.offline) return true
  }
  return false
}
