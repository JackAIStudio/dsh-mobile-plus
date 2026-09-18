/**
 * Message markup generation and display filters.
 */
import { state, chat, runtime } from '../state/state.js'
import { openImageLightbox } from './lightbox.js'
import { parseTodos, renderTodoCard } from './todo.js'
import { parseInboxDelivery, isImageName } from '../chat/upload.js'
import { retryOutbox } from '../chat/outbox.js'
import { el, basename } from '../utils/dom.js'
import { formatTime } from '../utils/time.js'
import { renderMarkdown } from './markdown.js'
import { isImageTool, renderToolImageCard } from '../chat/tool-image.js'
import { renderToolGroupCard } from './tool-group.js'
import { loadAttachmentUrl, getPathImageUrl } from '../chat/attachment-loader.js'

export function isHiddenSystemMessage(m) {
  if (chat.showSystemMessages) return false
  if (m.kind === 'user') {
    if (m.sourceKind !== undefined && m.sourceKind !== 'user') return true
    const text = typeof m.text === 'string' ? m.text.trim() : ''
    if (text.startsWith('<system-reminder') || text.startsWith('Current runtime context')) return true
  }
  return false
}

export function messageHtml(m) {
  if (m.kind === 'command-result') {
    const isError = m.outcome === 'error'
    const cmdName = m.commandName || '命令'
    return el('div', { class: `chat-msg chat-msg-command-result ${isError ? 'chat-msg-failed' : ''}` }, [
      el('div', { class: 'command-result-header' }, [
        el('span', { class: 'command-result-icon', html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3.5l5 4.5-5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
        el('span', { class: 'command-result-name' }, [cmdName]),
        el('span', { class: 'command-result-tag' }, [isError ? '失败' : '完成']),
      ]),
      el('div', { class: 'command-result-text' }, [m.text || '']),
      el('span', { class: 'chat-msg-time' }, [formatTime(m.time)]),
    ])
  }

  const cls = ['chat-msg', m.kind === 'user' ? 'chat-msg-user' : 'chat-msg-assistant']
  if (m.isCommand) cls.push('chat-msg-command')
  if (m.pending) cls.push('chat-msg-pending')
  if (m.failed) cls.push('chat-msg-failed')

  if (m.kind === 'user') {
    if (m.local) cls.push('chat-msg-local')
    if (m.localStatus === 'sending') cls.push('chat-msg-sending')
    const status = m.localStatus === 'sending'
      ? '发送中…'
      : m.localStatus === 'sent'
        ? '已发送'
        : formatTime(m.time)
    const parsed = m.local ? { text: m.text || '', paths: m.paths || [] } : parseInboxDelivery(m.text)
    const thumbs = []
    if (m.images?.length) thumbs.push(...m.images)
    if (!m.local) {
      for (const path of parsed.paths) {
        const preview = runtime.previewByPath.get(path)
        if (preview && !thumbs.includes(preview)) {
          thumbs.push(preview)
        } else if (isImageName(path)) {
          thumbs.push({ path, name: basename(path) })
        }
      }
    }
    const fileCards = m.local
      ? (m.fileCards || [])
      : parsed.paths.filter((path) => !runtime.previewByPath.has(path) && !isImageName(path)).map((path) => ({ name: basename(path), path }))
    return el('div', { class: cls.join(' ') }, [
      parsed.text ? el('div', { class: 'chat-msg-text' }, [parsed.text]) : null,
      thumbs.length ? el('div', { class: 'chat-msg-images' }, thumbs.map((item) => {
        if (typeof item === 'string') {
          return el('button', {
            type: 'button',
            class: 'chat-msg-image-btn',
            'aria-label': '放大查看图片',
            onclick: () => openImageLightbox(item),
          }, [el('img', { src: item, alt: '' })])
        }
        if (item && item.attachmentId) {
          const sessId = state.session?.sessionId || ''
          const img = el('img', { alt: item.name || '', class: 'chat-msg-thumb-img' })
          const btn = el('button', {
            type: 'button',
            class: 'chat-msg-image-btn',
            'aria-label': '放大查看图片',
            onclick: async () => {
              const thumb = img.src || await loadAttachmentUrl(sessId, item.attachmentId, 'thumb')
              const raw = await loadAttachmentUrl(sessId, item.attachmentId, 'raw')
              openImageLightbox(thumb, raw)
            },
          }, [img])
          loadAttachmentUrl(sessId, item.attachmentId, 'thumb').then((url) => { img.src = url })
          return btn
        }
        if (item && item.path) {
          const thumbUrl = getPathImageUrl(item.path, 'thumb')
          const rawUrl = getPathImageUrl(item.path, 'raw')
          const img = el('img', { alt: item.name || '', class: 'chat-msg-thumb-img', src: thumbUrl, loading: 'lazy' })
          return el('button', {
            type: 'button',
            class: 'chat-msg-image-btn',
            'aria-label': '放大查看图片',
            onclick: () => {
              openImageLightbox(thumbUrl, rawUrl)
            },
          }, [img])
        }
        return null
      }).filter(Boolean)) : null,
      fileCards.length ? el('div', { class: 'chat-msg-files' }, fileCards.map((file) => {
        const isImg = isImageName(file.name || '')
        return el('div', { class: 'chat-msg-file', title: file.name || '' }, [
          el('span', { class: 'chat-msg-file-icon' }, [isImg ? '🖼️' : '📄']),
          el('span', { class: 'chat-msg-file-name' }, [file.name || '文件']),
        ])
      })) : null,
      m.localStatus === 'failed'
        ? el('button', {
            type: 'button',
            class: 'chat-msg-failtag chat-msg-retry',
            onclick: () => { void retryOutbox(m) },
          }, ['发送失败，点此重试'])
        : el('span', { class: 'chat-msg-time' }, [status]),
    ])
  }

  const kids = []
  if (m.reasoning) {
    kids.push(el('details', { class: 'chat-disclosure' }, [
      el('summary', { class: 'chat-disclosure-head' }, [
        el('span', { class: 'chat-disclosure-caret' }, ['›']),
        el('span', { class: 'chat-disclosure-label' }, ['深度思考']),
        el('span', { class: 'chat-disclosure-summary' }, [m.reasoning.split('\n')[0].slice(0, 60)]),
      ]),
      el('div', { class: 'chat-disclosure-body' }, [m.reasoning]),
    ]))
  }
  if (m.tools?.length) {
    const imageTools = []
    const todoTools = []
    const otherTools = []
    for (const tool of m.tools) {
      if (isImageTool(tool)) {
        imageTools.push(tool)
        continue
      }
      if (tool.name === 'todo_write') {
        const parsed = parseTodos(tool.arguments)
        if (parsed) {
          todoTools.push(parsed)
          continue
        }
      }
      otherTools.push(tool)
    }
    const sessId = state.session?.sessionId || ''
    for (const imgTool of imageTools) kids.push(renderToolImageCard(imgTool, sessId))
    if (chat.showToolCalls) {
      for (const todos of todoTools) kids.push(renderTodoCard(todos))
      if (otherTools.length > 0) {
        const card = renderToolGroupCard({
          id: `tool-group-inner-${m.id}`,
          tools: otherTools,
          isRunning: m.pending || otherTools.some((t) => t.status === 'running'),
        })
        if (card) kids.push(card)
      }
    }
  }
  if (m.pending) {
    kids.push(el('div', { class: 'chat-msg-text' }, [m.text || '']))
  } else {
    kids.push(el('div', { class: 'chat-msg-text chat-md chat-md-body', html: renderMarkdown(m.text || '') }))
  }
  if (m.failed) kids.push(el('span', { class: 'chat-msg-failtag' }, ['失败']))
  kids.push(el('span', { class: 'chat-msg-time' }, [formatTime(m.time)]))
  return el('div', { class: cls.join(' ') }, kids)
}
