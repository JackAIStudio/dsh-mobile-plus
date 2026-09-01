/**
 * Composer attachments and binary upload.
 */
import { state, runtime } from '../state/state.js'
import { el } from '../utils/dom.js'
import { formatBytes } from '../utils/time.js'
import { rpcId } from '../net/rpc.js'
import { closeImageLightbox } from '../ui/lightbox.js'
import { syncComposerDraft } from './composer.js'
import { render } from '../ui/views/render.js'

const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function isImageName(name) {
    return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(name || '')
  }

export function isImageAttachment(att) {
    if (att && att.mime && att.mime.startsWith('image/')) return true
    return isImageName(att && att.name)
  }

export function parseInboxDelivery(text) {
    const raw = String(text || '')
    const markers = ['【相关的文件目录】', '【参考文件】', '【手机发来的文件】', '【手机发来的图片】']
    let idx = -1
    for (const marker of markers) {
      const at = raw.indexOf(marker)
      if (at !== -1 && (idx === -1 || at < idx)) idx = at
    }
    if (idx === -1) return { text: raw, paths: [] }
    const before = raw.slice(0, idx).trim()
    const firstNl = raw.indexOf('\n', idx)
    const body = firstNl === -1 ? '' : raw.slice(firstNl + 1)
    const paths = []
    const leftover = []
    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      if (/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(trimmed) && !/^(请立刻|会话内容|不要根据|不要在尚未|纯文本模型|原图已经|这就是你应该看)/.test(trimmed)) {
        paths.push(trimmed)
        continue
      }
      leftover.push(trimmed)
    }
    const extra = leftover.filter((line) => !/请立刻|会话内容|不要根据|不要在尚未|纯文本模型|read_image|这就是你应该看的版本|原图已经/.test(line))
    return { text: [before, extra.join('\n')].filter(Boolean).join('\n').trim(), paths }
  }

export function bumpAttachProgress() {
    if (runtime.attachProgressTimer) return
    runtime.attachProgressTimer = setTimeout(() => {
      runtime.attachProgressTimer = 0
      if (state.view === 'chat') render()
    }, 200)
  }

export function ensureFileInput() {
    if (runtime.fileInput) return runtime.fileInput
    runtime.fileInput = el('input', {
      type: 'file',
      multiple: true,
      class: 'attach-input',
      onchange: onPickFiles,
    })
    document.body.append(runtime.fileInput)
    return runtime.fileInput
  }

export function makeAttachment(file) {
    const att = {
      id: rpcId(),
      file,
      name: file.name || (file.type === 'image/png' ? 'image.png' : 'file'),
      mime: file.type || '',
      size: file.size,
      status: 'pending',
      progress: 0,
      path: '',
      error: '',
      preview: '',
      xhr: null,
    }
    if (isImageAttachment(att)) {
      try { att.preview = URL.createObjectURL(file) } catch { /* ignore */ }
    }
    return att
  }

export function clearAttachments() {
    for (const att of state.attachments) {
      if (att.xhr) att.xhr.abort()
      if (att.preview && ![...runtime.previewByPath.values()].includes(att.preview)) {
        try { URL.revokeObjectURL(att.preview) } catch { /* ignore */ }
      }
    }
    state.attachments = []
  }

export function removeAttachment(id) {
    const att = state.attachments.find((row) => row.id === id)
    if (!att) return
    if (att.xhr) att.xhr.abort()
    if (att.preview && runtime.lightboxNode && runtime.lightboxNode.dataset.src === att.preview) closeImageLightbox()
    if (att.preview && !runtime.previewByPath.has(att.path)) {
      try { URL.revokeObjectURL(att.preview) } catch { /* ignore */ }
    }
    state.attachments = state.attachments.filter((row) => row.id !== id)
    render()
  }

export function uploadOne(att, sessionId) {
    return new Promise((resolve) => {
      if (att.status === 'uploaded' && att.path) {
        resolve(att)
        return
      }
      att.status = 'uploading'
      att.progress = 0
      att.error = ''
      const xhr = new XMLHttpRequest()
      att.xhr = xhr
      xhr.open('POST', '/mp/api/mobile.upload')
      xhr.withCredentials = true
      xhr.setRequestHeader('x-mp-filename', encodeURIComponent(att.name || 'file'))
      xhr.setRequestHeader('x-mp-session-id', sessionId)
      if (att.mime) xhr.setRequestHeader('x-mp-media-type', att.mime)
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return
        att.progress = ev.loaded / ev.total
        bumpAttachProgress()
      }
      xhr.onload = () => {
        att.xhr = null
        let body
        try { body = JSON.parse(xhr.responseText) } catch { body = null }
        if (xhr.status === 403) {
          att.status = 'failed'
          att.error = body?.error?.code === 'forbidden'
            ? '宿主端插件可能是旧版本：请重启 dsh web 后再试。'
            : '此设备未配对：请在电脑端重新生成配对链接。'
          resolve(att)
          return
        }
        const value = body?.result?.ok ? body.result.value : null
        if (xhr.status >= 200 && xhr.status < 300 && value && value.path) {
          att.status = 'uploaded'
          att.path = value.path
          att.progress = 1
          if (value.name) att.name = value.name
          if (att.preview) runtime.previewByPath.set(value.path, att.preview)
          resolve(att)
          return
        }
        att.status = 'failed'
        att.error = body?.result?.error?.message || body?.error?.message || `上传失败 HTTP ${xhr.status}`
        resolve(att)
      }
      xhr.onerror = () => {
        att.xhr = null
        att.status = 'failed'
        att.error = '网络错误，上传失败'
        resolve(att)
      }
      xhr.onabort = () => {
        att.xhr = null
        if (att.status === 'uploading') {
          att.status = 'failed'
          att.error = '已取消'
        }
        resolve(att)
      }
      xhr.send(att.file)
    })
  }

export function ensureUpload(att, sessionId) {
    if (att.status === 'uploaded' && att.path) return Promise.resolve(att)
    const existing = runtime.uploadWaiters.get(att.id)
    if (existing) return existing
    const pending = uploadOne(att, sessionId).finally(() => runtime.uploadWaiters.delete(att.id))
    runtime.uploadWaiters.set(att.id, pending)
    return pending
  }

export function onPickFiles(ev) {
    const picked = [...(ev.target.files || [])]
    ev.target.value = ''
    const rejected = []
    for (const file of picked) {
      if (state.attachments.length >= MAX_ATTACHMENTS) {
        rejected.push('一次最多 5 个文件')
        break
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        rejected.push(`${file.name || '文件'} 超过 20MB`)
        continue
      }
      if (file.size === 0) {
        rejected.push(`${file.name || '文件'} 是空文件`)
        continue
      }
      const att = makeAttachment(file)
      state.attachments.push(att)
      if (state.session) {
        void ensureUpload(att, state.session.sessionId).then(() => {
          if (state.view === 'chat') render()
        })
      }
    }
    state.sheet = null
    if (rejected.length) state.error = rejected[0]
    else state.error = ''
    render()
  }

export function pickFromFiles() {
    ensureFileInput().click()
  }

export function removeComposerImage(index) {
    const att = state.attachments[index]
    if (att) removeAttachment(att.id)
  }
