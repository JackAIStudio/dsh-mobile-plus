import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { dshHome, MIME_MAP } from './constants.js'
import { isLoopback, svc } from './utils.js'

// Simple memory cache for thumbnails: key -> { buffer, contentType, time }
const THUMB_CACHE = new Map()
const MAX_CACHE_ITEMS = 64

let cachedSharp = undefined

function getSharp() {
  if (cachedSharp !== undefined) return cachedSharp
  try {
    const req = createRequire(import.meta.url)
    cachedSharp = req('sharp')
    return cachedSharp
  } catch {}
  try {
    const req = createRequire(process.cwd())
    cachedSharp = req('sharp')
    return cachedSharp
  } catch {}
  try {
    const req = createRequire('/usr/local/lib/node_modules/noop.js')
    cachedSharp = req('@deepseek-ai/dsh/node_modules/sharp')
    return cachedSharp
  } catch {}
  cachedSharp = null
  return null
}

function detectMime(buffer) {
  if (!buffer || buffer.length < 4) return 'application/octet-stream'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return 'image/jpeg'
}

async function readAttachmentRaw(ctx, sessionId, attachmentId) {
  const hex = attachmentId.startsWith('sha256:') ? attachmentId.slice(7) : attachmentId
  if (/^[0-9a-f]{64}$/i.test(hex)) {
    const localFile = join(dshHome(), 'attachments', 'v1', 'objects', hex.slice(0, 2), hex)
    if (existsSync(localFile)) {
      const buffer = await readFile(localFile)
      return { buffer, contentType: detectMime(buffer) }
    }
  }

  const sessionCtrl = svc(ctx, 'sessionController')
  if (typeof sessionCtrl?.attachment === 'function') {
    try {
      const res = await sessionCtrl.attachment({ sessionId, attachmentId })
      const val = res?.value || res
      const raw = val?.data
      if (raw) {
        const buf = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.from(raw)
        const type = val.attachment?.mediaType || detectMime(buf)
        return { buffer: buf, contentType: type }
      }
    } catch {}
  }

  const attachmentsSvc = svc(ctx, 'attachments')
  if (attachmentsSvc && typeof attachmentsSvc.readImage === 'function') {
    try {
      const stored = await attachmentsSvc.readImage({ attachmentId })
      if (stored?.data) {
        const buf = Buffer.isBuffer(stored.data) ? stored.data : Buffer.from(stored.data)
        const type = stored.ref?.mediaType || detectMime(buf)
        return { buffer: buf, contentType: type }
      }
    } catch {}
  }

  const proxy = svc(ctx, 'apiProxy')
  if (typeof proxy?.sessions?.attachment === 'function') {
    try {
      const res = await proxy.sessions.attachment({ rpcId: `media-${Date.now()}`, payload: { sessionId, attachmentId } })
      if (res?.result?.ok && res.result.value?.data) {
        const raw = res.result.value.data
        const buf = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.from(raw)
        const type = res.result.value.attachment?.mediaType || detectMime(buf)
        return { buffer: buf, contentType: type }
      }
    } catch {}
  }

  return null
}

async function generateThumbnail(buffer, width = 480) {
  const sharp = getSharp()
  if (!sharp) return null
  try {
    const thumb = await sharp(buffer)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 78, progressive: true })
      .toBuffer()
    return { buffer: thumb, contentType: 'image/jpeg' }
  } catch {
    return null
  }
}

export async function handleAttachmentRequest(ctx, auth, req, res) {
  if (auth.requirePairing && !isLoopback(req) && !auth.touch(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Forbidden')
    return
  }

  const url = new URL(req.url || '/', 'http://x')
  const sessionId = url.searchParams.get('sessionId') || ''
  const attachmentId = url.searchParams.get('attachmentId') || ''
  const isThumb = url.searchParams.get('variant') === 'thumb' || url.searchParams.get('thumb') === '1'
  const widthParam = parseInt(url.searchParams.get('width') || '480', 10)
  const targetWidth = Number.isFinite(widthParam) && widthParam > 50 && widthParam <= 1200 ? widthParam : 480

  if (!attachmentId) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Missing attachmentId')
    return
  }

  const cacheKey = `${attachmentId}:${isThumb ? `thumb-${targetWidth}` : 'raw'}`
  const cached = THUMB_CACHE.get(cacheKey)
  if (cached) {
    res.writeHead(200, {
      'content-type': cached.contentType,
      'content-length': String(cached.buffer.length),
      'cache-control': 'public, max-age=31536000, immutable',
    })
    res.end(cached.buffer)
    return
  }

  try {
    const raw = await readAttachmentRaw(ctx, sessionId, attachmentId)
    if (!raw || !raw.buffer) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Attachment Not Found')
      return
    }

    let finalData = raw
    if (isThumb) {
      const thumb = await generateThumbnail(raw.buffer, targetWidth)
      if (thumb) finalData = thumb
    }

    if (THUMB_CACHE.size >= MAX_CACHE_ITEMS) {
      const oldestKey = THUMB_CACHE.keys().next().value
      if (oldestKey) THUMB_CACHE.delete(oldestKey)
    }
    THUMB_CACHE.set(cacheKey, finalData)

    res.writeHead(200, {
      'content-type': finalData.contentType,
      'content-length': String(finalData.buffer.length),
      'cache-control': 'public, max-age=31536000, immutable',
    })
    res.end(finalData.buffer)
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Internal Server Error')
  }
}
