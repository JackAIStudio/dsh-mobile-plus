import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { basename, extname, join } from 'node:path'
import { MAX_UPLOAD_BYTES } from './constants.js'
import { json, readRawBody } from './utils.js'

export function decodeHeaderFilename(raw) {
  if (typeof raw !== 'string' || raw === '') return 'file'
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function safeBasename(raw) {
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

export function uniquePath(filePath) {
  if (!existsSync(filePath)) return filePath
  const ext = extname(filePath)
  const stem = ext ? filePath.slice(0, -ext.length) : filePath
  for (let i = 2; i < 100; i += 1) {
    const next = `${stem}-${i}${ext}`
    if (!existsSync(next)) return next
  }
  return `${stem}-${Date.now()}${ext}`
}

export function sipsToJpeg(srcPath, destPath) {
  return new Promise((resolve) => {
    execFile('sips', ['-s', 'format', 'jpeg', srcPath, '--out', destPath], { timeout: 20_000 }, (error) => {
      resolve(!error && existsSync(destPath))
    })
  })
}

export function sipsThumbnail(srcPath, thumbPath) {
  return new Promise((resolve) => {
    execFile('sips', ['-Z', '320', '-s', 'format', 'jpeg', srcPath, '--out', thumbPath], { timeout: 10_000 }, (error) => {
      resolve({ status: error ? 1 : 0 })
    })
  })
}

export async function sessionCwd(ctx, sessionId) {
  let proxy;
try { proxy = ctx.apiProxy } catch {}
if (proxy) {
    try {
      const listed = await proxy.sessions.list({ rpcId: `mp-cwd-${Date.now()}`, payload: {} })
      if (listed.result?.ok) {
        const row = listed.result.value.items.find((item) => item.sessionId === sessionId)
        if (row?.cwd) return row.cwd
      }
    } catch { /* fall through */ }
    try {
      const workspaces = await proxy.workspace.list({ rpcId: `mp-ws-${Date.now()}`, payload: {} })
      if (workspaces.result?.ok && workspaces.result.value.items[0]?.path) {
        return workspaces.result.value.items[0].path
      }
    } catch { /* fall through */ }
  } else {
    try {
      if (ctx.sessionController?.list) {
        const listed = await ctx.sessionController.list({})
        const items = listed?.items || listed?.value?.items || []
        const row = items.find((item) => item.sessionId === sessionId)
        if (row?.cwd) return row.cwd
      }
    } catch { /* fall through */ }
    try {
      const items = (typeof ctx.workspaces?.list === "function" ? ctx.workspaces.list() : []) || []
      if (items[0]?.path) return items[0].path
    } catch { /* fall through */ }
  }
  return undefined
}

export async function persistPhoneImages(ctx, payload) {
  if (!payload || !Array.isArray(payload.content)) return payload
  const images = payload.content.filter((part) => part && part.type === 'image' && typeof part.data === 'string')
  if (images.length === 0) return payload
  const cwd = await sessionCwd(ctx, payload.sessionId)
  if (!cwd) return payload
  const dir = join(cwd, '.dsh-mobile-inbox')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const paths = []
  images.forEach((part, index) => {
    const raw = typeof part.fullData === 'string' && part.fullData !== '' ? part.fullData : part.data
    const ext = part.mediaType === 'image/png' ? 'png' : part.mediaType === 'image/webp' ? 'webp' : part.mediaType === 'image/gif' ? 'gif' : 'jpg'
    const filePath = join(dir, `${stamp}-${index + 1}.${ext}`)
    writeFileSync(filePath, Buffer.from(raw, 'base64'))
    paths.push(filePath)
    if (index === images.length - 1) {
      writeFileSync(join(dir, `latest.${ext}`), Buffer.from(raw, 'base64'))
    }
  })
  const note = ['【相关的文件目录】', ...paths].join('\n')
  const rest = payload.content
    .filter((part) => !(part && part.type === 'text' && String(part.text || '').match(/【(?:手机发来的文件|手机发来的图片|参考文件|相关的文件目录)】/)))
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

const THUMB_MAX_BYTES = 40 * 1024

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

export async function slimHistoryImages(events, cwd) {
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

export async function handleUpload(ctx, req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  const sessionId = typeof req.headers['x-mp-session-id'] === 'string' ? req.headers['x-mp-session-id'].trim() : ''
  if (sessionId === '') {
    json(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing sessionId' } })
    return
  }
  const cwd = await sessionCwd(ctx, sessionId)
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
