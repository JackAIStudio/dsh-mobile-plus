/**
 * Pairing and authorization status.
 */
import { call } from './rpc.js'

export function parsePairInput(value) {
    const trimmed = (value || '').trim()
    if (trimmed === '') return undefined
    try {
      const url = new URL(trimmed, window.location.origin)
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
    if (res.status === 404) return '配对链接无效或已过期。'
    if (res.status === 409) return '配对链接已被使用。'
    return '此设备无法使用该配对链接。'
  }

export async function pairStatus() {
    try {
      const res = await fetch('/mp/pair/status', { credentials: 'same-origin' })
      const data = await res.json()
      return data.paired === true
    } catch {
      return false
    }
  }
