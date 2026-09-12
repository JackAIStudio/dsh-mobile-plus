/**
 * Conversation Turn timeline aggregation and scroll anchors.
 */
import { state, runtime, chat } from '../state/state.js'
import { el } from '../utils/dom.js'
import { formatTime } from '../utils/time.js'

export function isHumanUserMessage(m) {
  if (!m || m.kind !== 'user') return false
  if (m.sourceKind !== undefined && m.sourceKind !== 'user') return false
  const rawText = typeof m.text === 'string' ? m.text.trim() : ''
  if (/^<system-reminder[\s>]/i.test(rawText) || rawText.startsWith('</system-reminder>')) return false
  if (/^Current runtime context/i.test(rawText)) return false
  if (rawText.startsWith('Approval response:') || rawText.startsWith('Tool result:')) return false
  if (!rawText && !m.images?.length && !m.paths?.length && !m.fileCards?.length) return false
  return true
}

export function cleanSummaryText(raw = '') {
  if (!raw) return ''
  return raw
    .replace(/^#+\s+/gm, '')
    .replace(/!\[.*?\]\(.*?\)/g, '[图片]')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ''))
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function deriveTurns(messages = [], localPending = []) {
  const turns = []
  let currentTurn = null
  let turnIndex = 0

  const all = [...messages, ...localPending]
  for (const m of all) {
    if (isHumanUserMessage(m)) {
      turnIndex += 1
      const cleaned = cleanSummaryText(m.text || '')
      currentTurn = {
        index: turnIndex,
        anchorId: `turn-anchor-${turnIndex}`,
        userMsg: m,
        userMsgId: m.id,
        userText: cleaned || (m.images?.length ? '（图片消息）' : (m.paths?.length ? '（附件文件）' : '（提问）')),
        hasImages: Boolean(m.images?.length || (m.paths && m.paths.some((p) => /\.(png|jpe?g|webp|gif)$/i.test(p)))),
        hasFiles: Boolean(m.paths?.length || m.fileCards?.length),
        time: m.time,
        assistantMsgs: [],
        tools: [],
        hasReasoning: false,
        replySummary: '',
        status: m.localStatus === 'failed' ? 'failed' : (m.localStatus === 'sending' ? 'running' : 'completed'),
      }
      turns.push(currentTurn)
    } else if (m.kind === 'assistant' && currentTurn) {
      currentTurn.assistantMsgs.push(m)
      if (m.pending) currentTurn.status = 'running'
      if (m.failed) currentTurn.status = 'failed'
      if (m.reasoning) currentTurn.hasReasoning = true
      if (Array.isArray(m.tools) && m.tools.length > 0) {
        for (const t of m.tools) {
          const name = t.name || 'tool'
          const existing = currentTurn.tools.find((x) => x.name === name)
          if (existing) existing.count += 1
          else currentTurn.tools.push({ name, count: 1 })
        }
      }
      if (m.text) {
        currentTurn.replySummary = cleanSummaryText(m.text)
      }
    }
  }
  return turns
}

export function scrollToTurn(anchorId) {
  const target = document.getElementById(anchorId)
  if (!target) return
  runtime.chatScroll.stick = false
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })

  target.classList.remove('turn-highlight-flash')
  void target.offsetWidth
  target.classList.add('turn-highlight-flash')
  setTimeout(() => {
    target.classList.remove('turn-highlight-flash')
  }, 1600)
}

export function scrollToLatest() {
  const scroller = document.querySelector('.chat-scroll')
  if (!scroller) return
  runtime.chatScroll.stick = true
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
}

export function renderTurnDivider(turn, onOpenSheet) {
  return el('div', {
    class: 'chat-turn-divider',
    id: turn.anchorId,
    'data-turn': String(turn.index),
  }, [
    el('div', { class: 'chat-turn-line' }),
    el('button', {
      type: 'button',
      class: 'chat-turn-badge',
      title: '点击打开时间线大纲',
      'aria-label': `第 ${turn.index} 轮对话，点击打开时间线`,
      onclick: (ev) => {
        ev.stopPropagation()
        if (typeof onOpenSheet === 'function') onOpenSheet()
      },
    }, [
      el('span', { class: 'chat-turn-badge-index' }, [`第 ${turn.index} 轮`]),
      turn.time ? el('span', { class: 'chat-turn-badge-time' }, [formatTime(turn.time)]) : null,
      el('span', { class: 'chat-turn-badge-icon', 'aria-hidden': 'true' }, ['≡']),
    ]),
    el('div', { class: 'chat-turn-line' }),
  ])
}
