/**
 * Session row card component with pin status, long-press gesture, and action menu.
 */
import { state } from '../../state/state.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { formatTime } from '../../utils/time.js'
import { sessionTitle } from '../../chat/fold.js'
import { sessionStatusDot, decorateSession } from '../../net/pending.js'
import { headerIcon } from '../theme.js'
import { openChat } from './chat-view.js'
import { findWorkspaceForSession } from './session-list-data.js'
import { createSessionInWorkspace } from './session-create.js'
import { isSessionPinned } from '../../net/pins.js'
import { openSessionActionSheet } from '../sheets/session-sheet.js'

export function sessionRow(raw, isSingleWs) {
  const s = decorateSession(raw)
  const ws = findWorkspaceForSession(s.sessionId) || state.workspace
  const wsName = ws ? workspaceTitle(ws) : ''
  const isCreatingHere = Boolean(state.creating && ws && state.creatingWorkspaceId === ws.workspaceId)
  const pinned = isSessionPinned(s.sessionId)

  let pressTimer = null
  let startX = 0
  let startY = 0
  let didLongPress = false

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  const onPointerDown = (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return
    didLongPress = false
    startX = ev.clientX
    startY = ev.clientY
    cancelPress()
    pressTimer = setTimeout(() => {
      didLongPress = true
      try { navigator.vibrate?.(25) } catch {}
      openSessionActionSheet(s)
    }, 480)
  }

  const onPointerMove = (ev) => {
    if (!pressTimer) return
    const dx = Math.abs(ev.clientX - startX)
    const dy = Math.abs(ev.clientY - startY)
    if (dx > 10 || dy > 10) cancelPress()
  }

  const onContextMenu = (ev) => {
    ev.preventDefault()
    cancelPress()
    openSessionActionSheet(s)
  }

  const titleNode = el('span', { class: 'mobile-rowTitle' }, [
    pinned ? el('span', { class: 'mobile-pin-tag', 'aria-label': '已置顶' }, ['📌']) : null,
    s.blank ? '新会话' : sessionTitle(s),
  ])

  // Action button on the right side of the card
  let rightAction = null
  if (pinned) {
    rightAction = el('button', {
      type: 'button',
      class: 'mobile-session-card-action is-pinned-action',
      title: '已置顶（点击管理会话）',
      'aria-label': '已置顶，点击管理会话',
      onclick: (ev) => {
        ev.stopPropagation()
        openSessionActionSheet(s)
      },
    }, [
      el('span', { style: 'font-size: 15px; line-height: 1;' }, ['📌']),
    ])
  } else if (!isSingleWs && ws) {
    rightAction = el('button', {
      type: 'button',
      class: 'mobile-session-card-action',
      disabled: state.creating,
      title: `在「${wsName}」新建会话（长按卡片可置顶）`,
      'aria-label': `在「${wsName}」新建会话`,
      onclick: (ev) => {
        ev.stopPropagation()
        void createSessionInWorkspace(ws)
      },
    }, [
      isCreatingHere
        ? el('span', { class: 'mobile-action-spinner' })
        : headerIcon('<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'),
    ])
  } else {
    rightAction = el('button', {
      type: 'button',
      class: 'mobile-session-card-action',
      title: '更多操作（置顶、复制 ID 等）',
      'aria-label': '会话操作',
      onclick: (ev) => {
        ev.stopPropagation()
        openSessionActionSheet(s)
      },
    }, [
      headerIcon('<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>'),
    ])
  }

  return el('li', { class: `mobile-session-card${pinned ? ' is-pinned' : ''}` }, [
    el('button', {
      type: 'button',
      class: 'mobile-session-card-main',
      onpointerdown: onPointerDown,
      onpointermove: onPointerMove,
      onpointerup: cancelPress,
      onpointercancel: cancelPress,
      oncontextmenu: onContextMenu,
      onclick: () => {
        if (didLongPress) {
          didLongPress = false
          return
        }
        if (ws && !state.workspace) state.workspace = ws
        void openChat(s)
      },
    }, [
      el('span', { class: 'mobile-rowMain' }, [
        el('span', { class: 'mobile-rowHeader' }, [
          titleNode,
          wsName && !isSingleWs ? el('span', { class: 'mobile-rowWsBadge' }, [wsName]) : null,
        ]),
        sessionStatusDot(s),
        el('span', { class: 'mobile-rowMeta' }, [formatTime(s.updatedAt)]),
      ]),
    ]),
    rightAction,
  ])
}
