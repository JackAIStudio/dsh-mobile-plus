/**
 * Conversation Turn Timeline Bottom Sheet.
 */
import { state, chat } from '../../state/state.js'
import { el } from '../../utils/dom.js'
import { formatTime } from '../../utils/time.js'
import { openOutbox } from '../../chat/outbox.js'
import { deriveTurns, scrollToTurn, scrollToLatest } from '../../chat/timeline.js'
import { closeSheet, syncSheetPortal } from './portal.js'

export function openTimelineSheet() {
  state.sheet = 'timeline'
  syncSheetPortal()
}

export function renderTimelineSheet() {
  const localPending = openOutbox()
  const turns = deriveTurns(chat.messages, localPending)

  const head = el('div', { class: 'sheet-head sheet-timeline-head' }, [
    el('div', { class: 'sheet-timeline-title-wrap' }, [
      el('h2', { class: 'sheet-title' }, ['对话时间线']),
      el('span', { class: 'sheet-timeline-count-badge' }, [`共 ${turns.length} 轮`]),
    ]),
    el('button', {
      type: 'button',
      class: 'sheet-close',
      'aria-label': '关闭时间线',
      onclick: closeSheet,
    }, ['×']),
  ])

  let bodyContent
  if (turns.length === 0) {
    bodyContent = el('div', { class: 'sheet-timeline-empty' }, [
      el('div', { class: 'sheet-timeline-empty-icon' }, ['⏱️']),
      el('div', { class: 'sheet-timeline-empty-title' }, ['暂无对话轮次']),
      el('div', { class: 'sheet-timeline-empty-desc' }, ['发送第一条消息后将自动生成大纲时间线']),
    ])
  } else {
    const listItems = turns.map((turn, idx) => {
      const isLast = idx === turns.length - 1
      const dotCls = ['timeline-dot']
      if (turn.status === 'running') dotCls.push('is-running')
      else if (turn.status === 'failed') dotCls.push('is-failed')
      else dotCls.push('is-done')

      const statusTag = turn.status === 'running'
        ? el('span', { class: 'timeline-status-tag is-running' }, ['⏳ 进行中'])
        : (turn.status === 'failed'
          ? el('span', { class: 'timeline-status-tag is-failed' }, ['✕ 失败'])
          : el('span', { class: 'timeline-status-tag is-done' }, ['✓ 完成']))

      const metaTags = []
      if (turn.hasReasoning) {
        metaTags.push(el('span', { class: 'timeline-meta-pill' }, ['💡 思考']))
      }
      for (const t of turn.tools.slice(0, 3)) {
        metaTags.push(el('span', { class: 'timeline-meta-pill' }, [`🛠️ ${t.name}${t.count > 1 ? ` ×${t.count}` : ''}`]))
      }
      if (turn.tools.length > 3) {
        metaTags.push(el('span', { class: 'timeline-meta-pill' }, [`+${turn.tools.length - 3} 工具`]))
      }

      return el('div', {
        class: 'timeline-item',
        onclick: () => {
          closeSheet()
          setTimeout(() => {
            scrollToTurn(turn.anchorId)
          }, 120)
        },
      }, [
        el('div', { class: 'timeline-track' }, [
          el('div', { class: dotCls.join(' ') }),
          !isLast ? el('div', { class: 'timeline-line' }) : null,
        ]),
        el('div', { class: 'timeline-card' }, [
          el('div', { class: 'timeline-card-header' }, [
            el('div', { class: 'timeline-card-title' }, [
              el('span', { class: 'timeline-turn-num' }, [`第 ${turn.index} 轮`]),
              statusTag,
            ]),
            turn.time ? el('span', { class: 'timeline-time' }, [formatTime(turn.time)]) : null,
          ]),
          el('div', { class: 'timeline-user-text' }, [
            turn.hasImages ? el('span', { class: 'timeline-inline-icon', title: '包含图片' }, ['📷 ']) : null,
            turn.hasFiles ? el('span', { class: 'timeline-inline-icon', title: '包含文件' }, ['📎 ']) : null,
            turn.userText,
          ]),
          metaTags.length || turn.replySummary ? el('div', { class: 'timeline-ai-preview' }, [
            metaTags.length ? el('div', { class: 'timeline-pills-row' }, metaTags) : null,
            turn.replySummary ? el('div', { class: 'timeline-reply-text' }, [turn.replySummary]) : null,
          ]) : null,
        ]),
      ])
    })

    bodyContent = el('div', { class: 'timeline-list' }, listItems)
  }

  const foot = el('div', { class: 'sheet-timeline-footer' }, [
    el('button', {
      type: 'button',
      class: 'sheet-timeline-bottom-btn',
      onclick: () => {
        closeSheet()
        setTimeout(() => {
          scrollToLatest()
        }, 120)
      },
    }, [
      el('span', { class: 'sheet-timeline-bottom-icon' }, ['↓']),
      '跳转回最新消息',
    ]),
  ])

  return el('div', { class: 'sheet-backdrop', onclick: closeSheet }, [
    el('div', {
      class: 'sheet sheet-timeline',
      onclick: (e) => e.stopPropagation(),
    }, [
      el('div', { class: 'sheet-handle' }),
      head,
      el('div', { class: 'sheet-body sheet-timeline-body' }, [bodyContent]),
      foot,
    ]),
  ])
}
