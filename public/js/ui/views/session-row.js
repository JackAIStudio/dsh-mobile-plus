/**
 * Session row card component with main chat navigation and workspace quick action.
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

export function sessionRow(raw, isSingleWs) {
  const s = decorateSession(raw)
  const ws = findWorkspaceForSession(s.sessionId) || state.workspace
  const wsName = ws ? workspaceTitle(ws) : ''
  const isCreatingHere = Boolean(state.creating && ws && state.creatingWorkspaceId === ws.workspaceId)

  return el('li', { class: 'mobile-session-card' }, [
    el('button', {
      type: 'button',
      class: 'mobile-session-card-main',
      onclick: () => {
        if (ws && !state.workspace) state.workspace = ws
        void openChat(s)
      },
    }, [
      el('span', { class: 'mobile-rowMain' }, [
        el('span', { class: 'mobile-rowHeader' }, [
          el('span', { class: 'mobile-rowTitle' }, [s.blank ? '新会话' : sessionTitle(s)]),
          wsName && !isSingleWs ? el('span', { class: 'mobile-rowWsBadge' }, [wsName]) : null,
        ]),
        sessionStatusDot(s),
        el('span', { class: 'mobile-rowMeta' }, [formatTime(s.updatedAt)]),
      ]),
    ]),
    !isSingleWs && ws
      ? el('button', {
          type: 'button',
          class: 'mobile-session-card-action',
          disabled: state.creating,
          title: `在「${wsName}」新建会话`,
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
      : el('span', { class: 'mobile-chevron', style: 'margin-right: 14px;' }, ['›']),
  ])
}
