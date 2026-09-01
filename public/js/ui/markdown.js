/**
 * GFM subset markdown parser and message markup generator.
 */
import { chat } from '../state/state.js'
import { openImageLightbox } from './lightbox.js'
import { parseTodos, renderTodoCard, chevronIcon } from './todo.js'
import { parseInboxDelivery } from '../chat/upload.js'
import { el } from '../utils/dom.js'

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char)
  }

export function safeUrl(raw) {
    const trimmed = raw.trim()
    if (trimmed === '') return null
    if (trimmed.startsWith('#')) return trimmed
    if (trimmed.startsWith('//')) return null
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
    if (scheme === null) return trimmed
    const name = scheme[1].toLowerCase()
    return name === 'http' || name === 'https' || name === 'mailto' ? trimmed : null
  }

export function findCloseParen(text, from) {
    let depth = 0
    for (let i = from; i < text.length; i += 1) {
      const char = text[i]
      if (char === '(') depth += 1
      else if (char === ')') {
        if (depth === 0) return i
        depth -= 1
      }
    }
    return -1
  }

export function renderInline(text) {
    let out = ''
    let i = 0
    const n = text.length
    while (i < n) {
      const char = text[i]
      if (char === '`') {
        const end = text.indexOf('`', i + 1)
        if (end !== -1) {
          out += '<code>' + escapeHtml(text.slice(i + 1, end)) + '</code>'
          i = end + 1
          continue
        }
      }
      if (char === '!' && text[i + 1] === '[') {
        const close = text.indexOf('](', i + 2)
        if (close !== -1) {
          const parenEnd = findCloseParen(text, close + 2)
          if (parenEnd !== -1) {
            const alt = text.slice(i + 2, close)
            const src = text.slice(close + 2, parenEnd)
            const safe = safeUrl(src)
            if (safe === null) out += escapeHtml(alt)
            else {
              const srcEsc = escapeHtml(safe).replace(/\s+/g, '%20')
              out += '<img alt="' + escapeHtml(alt) + '" src="' + srcEsc + '" />'
            }
            i = parenEnd + 1
            continue
          }
        }
      }
      if (char === '[') {
        const close = text.indexOf('](', i + 1)
        if (close !== -1) {
          const parenEnd = findCloseParen(text, close + 2)
          if (parenEnd !== -1) {
            const label = text.slice(i + 1, close)
            const href = text.slice(close + 2, parenEnd)
            const safe = safeUrl(href)
            if (safe === null) out += renderInline(label)
            else out += '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + renderInline(label) + '</a>'
            i = parenEnd + 1
            continue
          }
        }
      }
      if (char === '*' && text[i + 1] === '*') {
        const end = text.indexOf('**', i + 2)
        if (end !== -1) {
          out += '<strong>' + renderInline(text.slice(i + 2, end)) + '</strong>'
          i = end + 2
          continue
        }
      }
      if (char === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
        const end = text.indexOf('*', i + 1)
        if (end !== -1 && text[end + 1] !== '*') {
          out += '<em>' + renderInline(text.slice(i + 1, end)) + '</em>'
          i = end + 1
          continue
        }
      }
      if (char === '~' && text[i + 1] === '~') {
        const end = text.indexOf('~~', i + 2)
        if (end !== -1) {
          out += '<del>' + renderInline(text.slice(i + 2, end)) + '</del>'
          i = end + 2
          continue
        }
      }
      out += escapeHtml(char)
      i += 1
    }
    return out
  }

export function splitTableRow(line) {
    const trimmed = line.trim()
    const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
    const withoutTrailing = inner.endsWith('|') ? inner.slice(0, -1) : inner
    return withoutTrailing.split('|').map((cell) => cell.trim())
  }

export function renderMarkdown(source) {
    const lines = source.replace(/\r\n/g, '\n').split('\n')
    const out = []
    let i = 0
    const n = lines.length

    const flushParagraph = (buffer) => {
      if (buffer.length === 0) return
      out.push('<p>' + renderInline(buffer.join('\n')) + '</p>')
      buffer.length = 0
    }

    let paragraph = []
    while (i < n) {
      const line = lines[i]

      const fence = /^```([\w+-]*)\s*$/.exec(line)
      if (fence !== null) {
        flushParagraph(paragraph)
        const lang = fence[1] ?? ''
        i += 1
        const code = []
        while (i < n && !/^```\s*$/.test(lines[i])) {
          code.push(lines[i])
          i += 1
        }
        i += 1
        const langAttr = lang === '' ? '' : ' class="language-' + escapeHtml(lang) + '"'
        out.push('<pre' + langAttr + '><code>' + escapeHtml(code.join('\n')) + '</code></pre>')
        continue
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line)
      if (heading !== null) {
        flushParagraph(paragraph)
        const level = heading[1].length
        out.push('<h' + level + '>' + renderInline(heading[2] ?? '') + '</h' + level + '>')
        i += 1
        continue
      }

      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        flushParagraph(paragraph)
        out.push('<hr />')
        i += 1
        continue
      }

      if (line.includes('|') && i + 1 < n && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        flushParagraph(paragraph)
        const headerCells = splitTableRow(line)
        i += 2
        const rows = []
        while (i < n && lines[i].includes('|')) {
          rows.push(splitTableRow(lines[i]))
          i += 1
        }
        out.push('<table>')
        out.push('<thead><tr>' + headerCells.map((cell) => '<th>' + renderInline(cell) + '</th>').join('') + '</tr></thead>')
        if (rows.length > 0) {
          out.push('<tbody>' + rows.map((row) => '<tr>' + row.map((cell) => '<td>' + renderInline(cell) + '</td>').join('') + '</tr>').join('') + '</tbody>')
        }
        out.push('</table>')
        continue
      }

      const quote = /^>\s?(.*)$/.exec(line)
      if (quote !== null) {
        flushParagraph(paragraph)
        const body = []
        while (i < n) {
          const q = /^>\s?(.*)$/.exec(lines[i])
          if (q === null) break
          body.push(q[1] ?? '')
          i += 1
        }
        out.push('<blockquote><p>' + body.map((bodyLine) => renderInline(bodyLine)).join('<br />') + '</p></blockquote>')
        continue
      }

      const ul = /^\s*([-*+])\s+(.*)$/.exec(line)
      if (ul !== null) {
        flushParagraph(paragraph)
        const items = []
        while (i < n) {
          const item = /^\s*([-*+])\s+(.*)$/.exec(lines[i])
          if (item === null) break
          items.push('<li>' + renderInline(item[2] ?? '') + '</li>')
          i += 1
        }
        out.push('<ul>' + items.join('') + '</ul>')
        continue
      }

      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
      if (ol !== null) {
        flushParagraph(paragraph)
        const items = []
        while (i < n) {
          const item = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
          if (item === null) break
          items.push('<li>' + renderInline(item[1] ?? '') + '</li>')
          i += 1
        }
        out.push('<ol>' + items.join('') + '</ol>')
        continue
      }

      if (line.trim() === '') {
        flushParagraph(paragraph)
        i += 1
        continue
      }

      paragraph.push(line)
      i += 1
    }
    flushParagraph(paragraph)
    return out.join('\n')
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
          const preview = previewByPath.get(path)
          if (preview && !thumbs.includes(preview)) thumbs.push(preview)
        }
      }
      const fileCards = m.local
        ? (m.fileCards || [])
        : parsed.paths.filter((path) => !previewByPath.has(path)).map((path) => ({ name: basename(path), path }))
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

export function isHiddenSystemMessage(m) {
    return m.kind === 'user'
      && m.sourceKind !== undefined
      && m.sourceKind !== 'user'
      && !chat.showSystemMessages
  }
