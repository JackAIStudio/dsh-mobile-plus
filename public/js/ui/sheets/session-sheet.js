/**
 * Session Action Sheet for pinning/unpinning, copying ID or mention, and workspace actions.
 */
import { state } from '../../state/state.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { formatTime } from '../../utils/time.js'
import { sessionTitle } from '../../chat/fold.js'
import { closeSheet, syncSheetPortal } from './portal.js'
import { isSessionPinned, toggleSessionPin, formatSessionReferenceMention } from '../../net/pins.js'
import { showToast } from '../../utils/toast.js'
import { findWorkspaceForSession } from '../views/session-list-data.js'
import { createSessionInWorkspace } from '../views/session-create.js'
import { openChat } from '../views/chat-view.js'

export function openSessionActionSheet(session) {
  if (!session || !session.sessionId) return
  state.actionSession = session
  state.sheet = 'session-actions'
  syncSheetPortal()
}

export function renderSessionActionSheet() {
  const session = state.actionSession
  if (!session) {
    closeSheet()
    return el('div')
  }

  const title = session.blank ? '新会话' : sessionTitle(session)
  const sessionId = session.sessionId
  const pinned = isSessionPinned(sessionId)
  const ws = findWorkspaceForSession(sessionId) || state.workspace
  const wsName = ws ? workspaceTitle(ws) : ''

  const pinItem = el('button', {
    type: 'button',
    class: 'sheet-nav-row session-sheet-action-btn',
    onclick: () => {
      closeSheet()
      void toggleSessionPin(sessionId, !pinned)
    },
  }, [
    el('span', { class: 'session-sheet-action-icon', 'aria-hidden': 'true' }, [pinned ? '📍' : '📌']),
    el('div', { class: 'sheet-toggle-copy' }, [
      el('span', { class: 'sheet-toggle-title' }, [pinned ? '取消置顶会话' : '置顶会话']),
      el('span', { class: 'sheet-toggle-desc' }, [
        pinned ? '从会话列表置顶分组中移除' : '固定显示在手机端与 Web 端会话列表最顶部',
      ]),
    ]),
    el('span', { class: `session-sheet-pin-pill${pinned ? ' is-active' : ''}` }, [pinned ? '已置顶' : '未置顶']),
  ])

  const copyIdItem = el('button', {
    type: 'button',
    class: 'sheet-nav-row session-sheet-action-btn',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(sessionId)
        showToast('已复制会话 ID')
      } catch {
        showToast('复制失败')
      }
      closeSheet()
    },
  }, [
    el('span', { class: 'session-sheet-action-icon', 'aria-hidden': 'true' }, ['📋']),
    el('div', { class: 'sheet-toggle-copy' }, [
      el('span', { class: 'sheet-toggle-title' }, ['复制会话 ID']),
      el('span', { class: 'sheet-toggle-desc' }, [sessionId]),
    ]),
  ])

  const copyMentionItem = el('button', {
    type: 'button',
    class: 'sheet-nav-row session-sheet-action-btn',
    onclick: async () => {
      try {
        const mention = formatSessionReferenceMention(sessionId, title)
        await navigator.clipboard.writeText(mention)
        showToast('已复制会话引用')
      } catch {
        showToast('复制失败')
      }
      closeSheet()
    },
  }, [
    el('span', { class: 'session-sheet-action-icon', 'aria-hidden': 'true' }, ['💬']),
    el('div', { class: 'sheet-toggle-copy' }, [
      el('span', { class: 'sheet-toggle-title' }, ['复制会话引用']),
      el('span', { class: 'sheet-toggle-desc' }, ['粘贴到输入框会变成官方 @ 会话卡片']),
    ]),
  ])

  const openItem = el('button', {
    type: 'button',
    class: 'sheet-nav-row session-sheet-action-btn',
    onclick: () => {
      closeSheet()
      if (ws && !state.workspace) state.workspace = ws
      void openChat(session)
    },
  }, [
    el('span', { class: 'session-sheet-action-icon', 'aria-hidden': 'true' }, ['↗']),
    el('div', { class: 'sheet-toggle-copy' }, [
      el('span', { class: 'sheet-toggle-title' }, ['进入对话']),
      el('span', { class: 'sheet-toggle-desc' }, ['打开并继续此会话']),
    ]),
  ])

  const newSessionItem = ws ? el('button', {
    type: 'button',
    class: 'sheet-nav-row session-sheet-action-btn',
    onclick: () => {
      closeSheet()
      void createSessionInWorkspace(ws)
    },
  }, [
    el('span', { class: 'session-sheet-action-icon', 'aria-hidden': 'true' }, ['+']),
    el('div', { class: 'sheet-toggle-copy' }, [
      el('span', { class: 'sheet-toggle-title' }, [`在此工作区新建会话`]),
      el('span', { class: 'sheet-toggle-desc' }, [`在「${wsName}」创建新对话`]),
    ]),
  ]) : null

  return el('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }, [
    el('div', {
      class: 'sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '会话操作',
      onclick: (ev) => { ev.stopPropagation() },
    }, [
      el('div', { class: 'sheet-handle' }),
      el('div', { class: 'sheet-title sheet-context-title-bar' }, [
        el('div', { class: 'session-sheet-header' }, [
          el('div', { class: 'session-sheet-header-title' }, [title]),
          el('div', { class: 'session-sheet-header-meta' }, [
            wsName ? el('span', { class: 'session-sheet-ws' }, [wsName]) : null,
            el('span', {}, [formatTime(session.updatedAt)]),
          ]),
        ]),
        el('button', {
          type: 'button',
          class: 'sheet-context-close-btn',
          'aria-label': '关闭',
          onclick: () => closeSheet(),
        }, ['✕']),
      ]),
      el('div', { class: 'sheet-body', style: 'padding-top: 4px;' }, [
        pinItem,
        copyMentionItem,
        copyIdItem,
        openItem,
        newSessionItem,
      ].filter(Boolean)),
    ]),
  ])
}
