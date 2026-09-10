/**
 * Chat top navigation bar with dual-line workspace/session breadcrumb and quick context trigger.
 */
import { state } from '../../state/state.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { sessionTitle } from '../../chat/fold.js'
import { navBack } from '../../state/route.js'
import { renderQuotaBar } from '../../net/quota.js'
import { headerActions, globalSettingsButton } from '../theme.js'
import { findWorkspaceForSession } from './session-list-data.js'
import { openChatContextSheet } from '../sheets/context-sheet.js'

export function currentChatWorkspace() {
  if (state.workspace) return state.workspace
  if (state.session?.sessionId) {
    const ws = findWorkspaceForSession(state.session.sessionId)
    if (ws) {
      state.workspace = ws
      return ws
    }
  }
  return null
}

export function renderChatHeaderTitle() {
  const ws = currentChatWorkspace()
  const wsName = ws ? workspaceTitle(ws) : '工作区'
  const currentTitle = state.session ? sessionTitle(state.session) : '聊天'

  const wsIconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'

  return el('button', {
    type: 'button',
    class: 'chat-header-title-btn',
    'aria-label': `工作区：${wsName}，当前会话：${currentTitle}。点击查看详情与切换会话`,
    title: `${wsName} / ${currentTitle}`,
    onclick: () => {
      openChatContextSheet()
    },
  }, [
    el('div', { class: 'chat-header-title-wrap' }, [
      el('div', { class: 'chat-header-ws' }, [
        el('span', { class: 'chat-header-ws-icon', html: wsIconSvg, 'aria-hidden': 'true' }),
        el('span', { class: 'chat-header-ws-name' }, [wsName]),
        el('span', { class: 'chat-header-chevron', 'aria-hidden': 'true' }, ['⌄']),
      ]),
      el('div', { class: 'chat-header-session' }, [
        el('span', { class: 'chat-header-session-text' }, [currentTitle]),
      ]),
    ]),
  ])
}

export function renderChatHeader() {
  return el('header', { class: 'mobile-header' }, [
    el('button', {
      type: 'button',
      class: 'mobile-back',
      'aria-label': '返回',
      onclick: () => {
        const ws = currentChatWorkspace()
        navBack(
          state.listMode === 'flat'
            ? { view: 'sessions' }
            : (ws ? { view: 'sessions', workspaceId: ws.workspaceId } : { view: 'workspaces' })
        )
      },
    }, ['‹']),
    renderChatHeaderTitle(),
    headerActions([
      renderQuotaBar(),
      globalSettingsButton(),
    ]),
  ])
}
