/**
 * Context sheet for viewing active workspace details, copying paths, and switching sessions.
 */
import { state } from '../../state/state.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { formatTime } from '../../utils/time.js'
import { sessionTitle } from '../../chat/fold.js'
import { sessionStatusDot, decorateSession } from '../../net/pending.js'
import { findWorkspaceForSession, ownedSessionIds } from '../views/session-list-data.js'
import { createSessionInWorkspace } from '../views/session-create.js'
import { showSessionsFromChat } from '../views/session-view.js'
import { openChat } from '../views/chat-view.js'
import { closeSheet, syncSheetPortal } from './portal.js'

export function openChatContextSheet() {
  state.sheet = 'chat-context'
  syncSheetPortal()
}

export function renderChatContextSheet() {
  const ws = state.workspace || (state.session?.sessionId ? findWorkspaceForSession(state.session.sessionId) : null)
  const wsName = ws ? workspaceTitle(ws) : '未指定工作区'
  const wsPath = ws?.path || '暂无工作区路径'
  const currentSessionId = state.session?.sessionId

  const copyBtn = el('button', {
    type: 'button',
    class: 'sheet-context-copy-btn',
    'aria-label': '复制工作区完整路径',
    onclick: async (ev) => {
      ev.stopPropagation()
      try {
        await navigator.clipboard.writeText(wsPath)
        copyBtn.textContent = '已复制 ✓'
        copyBtn.style.color = 'var(--m-accent)'
        setTimeout(() => {
          copyBtn.textContent = '复制'
          copyBtn.style.color = ''
        }, 1500)
      } catch {
        copyBtn.textContent = '失败'
      }
    },
  }, ['复制'])

  const wsSection = el('div', { class: 'sheet-section' }, [
    el('div', { class: 'sheet-section-title' }, ['当前工作区']),
    el('div', { class: 'sheet-context-card' }, [
      el('div', { class: 'sheet-context-ws-header' }, [
        el('div', { class: 'sheet-context-ws-title' }, [
          el('span', {
            class: 'chat-header-ws-icon',
            html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
            'aria-hidden': 'true',
          }),
          el('span', {}, [wsName]),
        ]),
      ]),
      el('div', { class: 'sheet-context-path-box' }, [
        el('span', { class: 'sheet-context-path-code', title: wsPath }, [wsPath]),
        copyBtn,
      ]),
    ]),
    ws ? el('button', {
      type: 'button',
      class: 'sheet-nav-row',
      onclick: () => {
        closeSheet()
        void createSessionInWorkspace(ws)
      },
    }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['在此工作区新建会话']),
        el('span', { class: 'sheet-toggle-desc' }, [`使用工作区「${wsName}」作为运行根目录`]),
      ]),
      el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['+']),
    ]) : null,
    ws ? el('button', {
      type: 'button',
      class: 'sheet-nav-row',
      onclick: () => {
        closeSheet()
        showSessionsFromChat(ws)
      },
    }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['查看该工作区会话列表']),
        el('span', { class: 'sheet-toggle-desc' }, ['返回列表查看属于此工作区的所有对话']),
      ]),
      el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['›']),
    ]) : null,
  ])

  // Collect sessions for this workspace
  let siblingSessions = []
  if (ws) {
    const owned = ownedSessionIds(ws)
    const all = state.sessions || []
    siblingSessions = all.filter((s) => owned.has(s.sessionId)).slice(0, 10)
    // Make sure current session is included if loaded
    if (state.session && !siblingSessions.some((s) => s.sessionId === currentSessionId)) {
      siblingSessions.unshift(state.session)
    }
  }

  const sessionItems = siblingSessions.map((raw) => {
    const s = decorateSession(raw)
    const isCurrent = s.sessionId === currentSessionId
    const title = s.blank ? '新会话' : sessionTitle(s)

    return el('button', {
      type: 'button',
      class: `sheet-context-session-card${isCurrent ? ' is-active' : ''}`,
      onclick: () => {
        if (isCurrent) {
          closeSheet()
          return
        }
        closeSheet()
        void openChat(s)
      },
    }, [
      el('div', { class: 'sheet-context-session-left' }, [
        sessionStatusDot(s),
        el('span', { class: 'sheet-context-session-title' }, [title]),
        isCurrent ? el('span', { class: 'sheet-context-badge-current' }, ['当前']) : null,
      ]),
      el('div', { class: 'sheet-context-session-right' }, [
        el('span', { class: 'sheet-context-session-time' }, [formatTime(s.updatedAt)]),
        el('span', { class: 'sheet-context-session-chevron', 'aria-hidden': 'true' }, [isCurrent ? '✓' : '›']),
      ]),
    ])
  })

  const sessionsSection = siblingSessions.length > 0 ? el('div', { class: 'sheet-section' }, [
    el('div', { class: 'sheet-section-title' }, [`当前工作区会话 (${siblingSessions.length})`]),
    el('div', { class: 'sheet-context-card', style: 'padding: 0; overflow: hidden;' }, sessionItems),
  ]) : null

  return el('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }, [
    el('div', {
      class: 'sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '工作区与会话',
      onclick: (ev) => { ev.stopPropagation() },
    }, [
      el('div', { class: 'sheet-handle' }),
      el('div', { class: 'sheet-title sheet-context-title-bar' }, [
        el('span', {}, ['工作区与会话']),
        el('button', {
          type: 'button',
          class: 'sheet-context-close-btn',
          'aria-label': '关闭',
          onclick: () => closeSheet(),
        }, ['✕']),
      ]),
      el('div', { class: 'sheet-body' }, [
        wsSection,
        sessionsSection,
      ].filter(Boolean)),
    ]),
  ])
}
