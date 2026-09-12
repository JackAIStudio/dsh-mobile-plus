/**
 * Message markup generation and display filters.
 */
import { chat, runtime } from '../state/state.js'
import { openImageLightbox } from './lightbox.js'
import { parseTodos, renderTodoCard } from './todo.js'
import { parseInboxDelivery } from '../chat/upload.js'
import { retryOutbox } from '../chat/outbox.js'
import { el, basename } from '../utils/dom.js'
import { formatTime } from '../utils/time.js'
import { renderMarkdown } from './markdown.js'

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
  const cls = ['chat-msg', m.kind === 'user' ? 'chat-msg-user' : 'chat-msg-assistant']
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
        if (preview && !thumbs.includes(preview)) thumbs.push(preview)
      }
    }
    const fileCards = m.local
      ? (m.fileCards || [])
      : parsed.paths.filter((path) => !runtime.previewByPath.has(path)).map((path) => ({ name: basename(path), path }))
    return el('div', { class: cls.join(' ') }, [
      parsed.text ? el('div', { class: 'chat-msg-text' }, [parsed.text]) : null,
      thumbs.length ? el('div', { class: 'chat-msg-images' }, thumbs.map((src) => el('button', {
        type: 'button',
        class: 'chat-msg-image-btn',
        'aria-label': '放大查看图片',
        onclick: () => openImageLightbox(src),
      }, [el('img', { src, alt: '' })]))) : null,
      fileCards.length ? el('div', { class: 'chat-msg-files' }, fileCards.map((file) => el('div', { class: 'chat-msg-file' }, [
        el('span', { class: 'chat-msg-file-name' }, [file.name || '文件']),
      ]))) : null,
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
  if (chat.showToolCalls && m.tools?.length) {
    const todoTools = []
    const otherTools = []
    for (const tool of m.tools) {
      if (tool.name === 'todo_write') {
        const parsed = parseTodos(tool.arguments)
        if (parsed) {
          todoTools.push(parsed)
          continue
        }
      }
      otherTools.push(tool)
    }
    for (const todos of todoTools) kids.push(renderTodoCard(todos))
    if (otherTools.length > 0) {
      kids.push(el('details', { class: 'chat-disclosure' }, [
        el('summary', { class: 'chat-disclosure-head' }, [
          el('span', { class: 'chat-disclosure-caret' }, ['›']),
          el('span', { class: 'chat-disclosure-label' }, ['工具调用']),
          el('span', { class: 'chat-disclosure-count' }, [`${otherTools.length} 次`]),
        ]),
        el('div', { class: 'chat-disclosure-body chat-tools-body' },
          otherTools.map((tool) => el('div', { class: 'chat-tool-card' }, [
            el('div', { class: 'chat-tool-pills' }, [el('span', { class: 'chat-tool-pill' }, [tool.name])]),
            tool.arguments ? el('pre', { class: 'chat-tool-args' }, [tool.arguments]) : null,
          ]))),
      ]))
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
