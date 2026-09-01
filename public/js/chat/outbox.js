/**
 * Optimistic user bubbles and message delivery outbox.
 */
import { state, chat, runtime } from '../state/state.js'
import { call, rpcId } from '../net/rpc.js'
import { nudgeMux } from '../net/mux.js'
import { isRecord, imagesFromContent, textFromContent, pickString } from './fold.js'
import { parseSlashLine } from './slash.js'
import { clearAttachments, ensureUpload, parseInboxDelivery, isImageAttachment } from './upload.js'
import { setDraft, focusComposer } from './composer.js'
import { render } from '../ui/views/render.js'

export function openOutbox() {
    const sid = state.session?.sessionId
    if (!sid) return []
    return chat.outbox.filter((item) => item.sessionId === sid)
  }

export function userMessageFromEvent(event) {
    const data = isRecord(event.data) ? event.data : {}
    const source = isRecord(data.source) ? data.source : {}
    const images = imagesFromContent(data.content)
    return {
      kind: 'user',
      text: textFromContent(data.content),
      ...(images.length > 0 ? { images } : {}),
      seq: event.seq,
      time: event.time,
      sourceKind: pickString(source.kind),
    }
  }

export function isEchoOf(item, message) {
    if (!item || !message || message.kind !== 'user' || message.local) return false
    if (message.sourceKind !== undefined && message.sourceKind !== 'user') return false
    if (typeof message.seq === 'number' && typeof item.afterSeq === 'number' && message.seq <= item.afterSeq) return false
    const rawEcho = String(message.text || '')
    const echo = parseInboxDelivery(rawEcho).text.trim()
    const local = String(item.text || '').trim()
    const delivered = rawEcho.includes('【相关的文件目录】') || rawEcho.includes('【参考文件】') || rawEcho.includes('【手机发来的文件】') || rawEcho.includes('【手机发来的图片】')
    if (local && echo === local) return true
    if (local && rawEcho.includes(local) && ((item.images && item.images.length > 0) || (item.fileCards && item.fileCards.length > 0) || delivered)) return true
    if (!local && ((item.images && item.images.length > 0) || (item.fileCards && item.fileCards.length > 0) || (item.paths && item.paths.length > 0)) && ((message.images && message.images.length > 0) || delivered)) return true
    return false
  }

export function dropOutboxEcho(sessionId, event) {
    if (!sessionId || chat.outbox.length === 0) return false
    const message = userMessageFromEvent(event)
    const index = chat.outbox.findIndex((item) => (
      item.sessionId === sessionId && item.localStatus !== 'failed' && isEchoOf(item, message)
    ))
    if (index === -1) return false
    chat.outbox.splice(index, 1)
    return true
  }

export function reconcileOutbox(sessionId) {
    if (!sessionId || chat.outbox.length === 0) return false
    const used = new Set()
    const next = []
    let changed = false
    for (const item of chat.outbox) {
      if (item.sessionId !== sessionId || item.localStatus === 'failed') {
        next.push(item)
        continue
      }
      const echo = chat.messages.find((message) => !used.has(message.id) && isEchoOf(item, message))
      if (echo) {
        used.add(echo.id)
        changed = true
        continue
      }
      next.push(item)
    }
    if (!changed) return false
    chat.outbox = next
    return true
  }

export async function deliverOutbox(item) {
    try {
      await call('session.prompt', { sessionId: item.sessionId, mode: 'queue', content: item.content })
      if (item.localStatus === 'sending') item.localStatus = 'sent'
      if (state.session?.sessionId === item.sessionId) state.running = true
      nudgeMux(item.sessionId)
    } catch (err) {
      item.localStatus = 'failed'
      item.failed = true
      state.error = String(err.message || err)
    }
    if (state.view === 'chat') render()
  }

export async function retryOutbox(item) {
    if (!item || item.localStatus === 'sending' || !state.session) return
    item.localStatus = 'sending'
    item.failed = false
    state.error = ''
    runtime.chatScroll.stick = true
    render()
    await deliverOutbox(item)
  }

export async function send() {
    const text = state.draft.trim()
    const pending = state.attachments.slice()
    if ((text === '' && pending.length === 0) || !state.session) return

    const parsed = parseSlashLine(text)
    const isCommand = Boolean(parsed && chat.slashCommands.some((row) => row.name === parsed.name) && pending.length === 0)

    state.error = ''
    runtime.chatScroll.stick = true

    if (isCommand) {
      setDraft('')
      state.sending = true
      render()
      focusComposer()
      try {
        const result = await call('command.execute', { sessionId: state.session.sessionId, line: text })
        const outcome = result && result.result
        if (outcome && outcome.kind === 'error' && outcome.text) {
          state.error = outcome.text
          if (state.draft === '' && state.attachments.length === 0) setDraft(text)
        }
      } catch (err) {
        state.error = String(err.message || err)
        if (state.draft === '' && state.attachments.length === 0) setDraft(text)
      } finally {
        state.sending = false
        render()
        focusComposer()
      }
      return
    }

    setDraft('')
    state.sending = true
    render()
    focusComposer()

    const sessionId = state.session.sessionId
    await Promise.all(pending.map((att) => ensureUpload(att, sessionId)))
    const ok = pending.filter((att) => att.status === 'uploaded' && att.path)
    const leftover = pending.filter((att) => !(att.status === 'uploaded' && att.path))
    state.attachments = leftover
    if (leftover.some((att) => att.status === 'failed')) {
      state.error = leftover.find((att) => att.error)?.error || '部分文件上传失败'
    }

    if (ok.length === 0 && text === '') {
      state.sending = false
      render()
      focusComposer()
      return
    }

    const note = ok.length ? `【相关的文件目录】\n${ok.map((att) => att.path).join('\n')}` : ''
    const promptText = [text, note].filter(Boolean).join('\n\n')
    const last = chat.messages[chat.messages.length - 1]
    const item = {
      id: `local:${rpcId()}`,
      kind: 'user',
      text,
      images: ok.filter(isImageAttachment).map((att) => att.preview).filter(Boolean),
      fileCards: ok.filter((att) => !isImageAttachment(att)).map((att) => ({ name: att.name, path: att.path })),
      paths: ok.map((att) => att.path),
      time: Date.now(),
      local: true,
      localStatus: 'sending',
      sessionId,
      afterSeq: last && typeof last.seq === 'number' ? last.seq : -1,
      content: [{ type: 'text', text: promptText }],
    }
    chat.outbox.push(item)
    state.sending = false
    render()
    focusComposer()
    await deliverOutbox(item)
  }

export async function stopTurn() {
    if (!state.session) return
    try { await call('session.cancel', { sessionId: state.session.sessionId }) } catch { /* ignore */ }
    state.running = false
    render()
  }
