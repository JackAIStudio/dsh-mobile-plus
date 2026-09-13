/**
 * Asynchronously resolves an attachmentId to a displayable browser URL.
 * Prefers the lightweight GET /mp/api/attachment route with thumb/raw variant;
 * gracefully falls back to POST session.attachment RPC (Blob URL) if GET is unhandled.
 */
import { call } from '../net/rpc.js'

const URL_CACHE = new Map()

export function peekAttachmentUrl(attachmentId, variant = 'thumb') {
  if (!attachmentId) return null
  return URL_CACHE.get(`${attachmentId}:${variant}`) || URL_CACHE.get(`${attachmentId}:raw`) || null
}

export async function loadAttachmentUrl(sessionId, attachmentId, variant = 'thumb') {
  if (!attachmentId) return ''
  const key = `${attachmentId}:${variant}`
  if (URL_CACHE.has(key)) return URL_CACHE.get(key)

  const getUrl = `/mp/api/attachment?sessionId=${encodeURIComponent(sessionId)}&attachmentId=${encodeURIComponent(attachmentId)}${variant === 'thumb' ? '&variant=thumb' : ''}`

  // 1. Try dedicated GET media route first
  try {
    const res = await fetch(getUrl, { method: 'GET', cache: 'default' })
    if (res.ok) {
      URL_CACHE.set(key, getUrl)
      return getUrl
    }
  } catch {}

  // 2. Fallback to RPC session.attachment (Base64 -> Blob URL)
  const blobKey = `${attachmentId}:blob`
  if (URL_CACHE.has(blobKey)) return URL_CACHE.get(blobKey)

  try {
    const res = await call('session.attachment', { sessionId, attachmentId })
    if (res && res.data) {
      const mime = res.attachment?.mediaType || 'image/jpeg'
      const binary = atob(res.data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: mime })
      const blobUrl = URL.createObjectURL(blob)
      URL_CACHE.set(blobKey, blobUrl)
      URL_CACHE.set(key, blobUrl)
      return blobUrl
    }
  } catch (err) {
    console.error('Failed to load attachment via RPC:', err)
  }

  return getUrl
}
