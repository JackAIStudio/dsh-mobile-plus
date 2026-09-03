/**
 * Sessions view with tabs, sorting, and live dot indicators.
 */
import { state, runtime } from '../../state/state.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { formatTime } from '../../utils/time.js'
import { onListScroll } from '../../utils/scroll.js'
import { call } from '../../net/rpc.js'
import { sessionTitle } from '../../chat/fold.js'
import { commitLocation, persistRoute } from '../../state/route.js'
import { sessionStatusDot, decorateSession } from '../../net/pending.js'
import { renderQuotaBar } from '../../net/quota.js'
import { headerIcon, headerActions, globalSettingsButton } from '../theme.js'
import { stopMuxObservation } from '../../net/mux.js'
import { render } from './render.js'
import { openChat } from './chat-view.js'
import { showWorkspaces } from './ws-view.js'
import {
  findWorkspaceForSession,
  switchListMode,
  ownedSessionIds,
  collectOwnedPages,
  loadSessions,
  startListPoll,
  stopListPoll,
  refreshLiveSnapshot,
} from './session-list-data.js'

export {
  findWorkspaceForSession,
  switchListMode,
  ownedSessionIds,
  loadSessions,
  startListPoll,
  stopListPoll,
  refreshLiveSnapshot,
}

export async function loadMoreSessions() {
  if (!state.cursor || state.loadingMore) return
  const q = runtime.sessionsQuery
  const workspaceId = state.workspace && state.workspace.workspaceId
  state.loadingMore = true
  if (state.view === 'sessions') render()
  try {
    const page = await collectOwnedPages(
      workspaceId,
      ownedSessionIds(state.workspace),
      state.cursor,
      [],
      Date.now(),
    )
    if (q !== runtime.sessionsQuery) return
    const seen = new Set(state.sessions.map((s) => s.sessionId))
    state.sessions = state.sessions.concat(page.items.filter((s) => !seen.has(s.sessionId)))
    state.cursor = page.nextCursor
    state.hasMoreSessions = page.hasMore
  } catch (err) {
    if (q !== runtime.sessionsQuery) return
    state.error = String(err.message || err)
  } finally {
    if (q === runtime.sessionsQuery) {
      state.loadingMore = false
      if (state.view === 'sessions') render()
    }
  }
}

export async function createSession() {
  if (state.creating) return
  if (!state.workspace) {
    state.createError = '没有选中工作区。'
    if (state.view === 'sessions') render()
    return
  }
  state.creating = true
  state.createError = ''
  render()
  try {
    const created = await call('session.create', {
      workspaceId: state.workspace.workspaceId,
      ...(state.presetId ? { agentPreset: state.presetId } : {}),
    })
    if (!created || !created.sessionId) {
      throw new Error('创建失败：宿主没有返回会话 ID。')
    }
    const ids = Array.isArray(state.workspace.sessionIds) ? state.workspace.sessionIds : []
    if (!ids.includes(created.sessionId)) {
      state.workspace.sessionIds = [created.sessionId].concat(ids)
    }
    await openChat({ sessionId: created.sessionId, title: '新会话' })
  } catch (err) {
    state.createError = String(err.message || err)
  } finally {
    state.creating = false
    if (state.view === 'sessions') render()
  }
}

export function showSessionsFromChat(ws, locationMode) {
  runtime.chatQuery += 1
  stopMuxObservation()
  state.workspace = ws
  state.session = null
  state.view = 'sessions'
  state.loading = false
  const loc = { view: 'sessions', workspaceId: ws.workspaceId }
  if (locationMode !== 'none') commitLocation(loc, locationMode)
  else persistRoute(loc)
  render()
  void loadSessions()
}

export function showRecentSessionsFromChat(locationMode) {
  runtime.chatQuery += 1
  stopMuxObservation()
  state.workspace = null
  state.session = null
  state.view = 'sessions'
  state.loading = false
  const loc = { view: 'sessions' }
  if (locationMode !== 'none') commitLocation(loc, locationMode)
  else persistRoute(loc)
  render()
  void loadSessions()
}

export async function openRecentSessions(opts = {}) {
  runtime.chatQuery += 1
  stopMuxObservation()
  state.workspace = null
  state.view = 'sessions'
  state.session = null
  state.sessions = []
  state.cursor = undefined
  state.hasMoreSessions = false
  state.createError = ''
  state.loading = true
  runtime.listScroll.top = 0
  const mode = opts.locationMode || 'push'
  if (mode !== 'none') commitLocation({ view: 'sessions' }, mode)
  else persistRoute({ view: 'sessions' })
  render()
  await loadSessions()
}

export function getSortedSessions() {
  const items = state.sessions.slice()
  if (state.sortMode === 'recent') {
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } else if (state.sortMode === 'manual' && state.workspace) {
    const orderMap = new Map((state.workspace.sessionIds || []).map((id, idx) => [id, idx]))
    items.sort((a, b) => (orderMap.get(a.sessionId) ?? 9999) - (orderMap.get(b.sessionId) ?? 9999))
  }
  return items
}

export function renderHeaderTabs() {
  return el('div', { class: 'mobile-header-left' }, [
    el('div', { class: 'mobile-tabs' }, [
      el('button', {
        type: 'button',
        class: state.listMode === 'workspace' ? 'mobile-tab mobile-tabActive' : 'mobile-tab',
        onclick: () => switchListMode('workspace'),
      }, ['工作区']),
      el('button', {
        type: 'button',
        class: state.listMode === 'flat' ? 'mobile-tab mobile-tabActive' : 'mobile-tab',
        onclick: () => switchListMode('flat'),
      }, ['最近会话']),
    ]),
    el('button', {
      type: 'button',
      class: 'mobile-sort-toggle-btn',
      title: state.sortMode === 'recent' ? '当前：按最近活跃时间排序（点击切换为手动排序）' : '当前：按 Web 端自定义顺序排序（点击切换为最近更新）',
      'aria-label': state.sortMode === 'recent' ? '排序：最近更新' : '排序：手动排序',
      onclick: () => {
        state.sortMode = state.sortMode === 'recent' ? 'manual' : 'recent'
        try { localStorage.setItem('dsh-mp-sort-mode', state.sortMode) } catch {}
        render()
      },
    }, [
      headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12M10 18h4"/></svg>'),
      el('span', { class: 'mobile-sort-toggle-label' }, [state.sortMode === 'recent' ? '最新' : '手动']),
    ]),
  ])
}

export function renderSessions() {
  const isSingleWs = Boolean(state.workspace)
  const page = el('div', { class: 'mobile' }, [
    el('header', { class: 'mobile-header' }, [
      isSingleWs
        ? el('button', { type: 'button', class: 'mobile-back', 'aria-label': '返回', onclick: () => showWorkspaces('push') }, ['‹'])
        : null,
      !isSingleWs
        ? renderHeaderTabs()
        : el('h1', { class: 'mobile-title mobile-titleInline' }, [workspaceTitle(state.workspace)]),
      headerActions([
        renderQuotaBar(),
        globalSettingsButton(),
      ]),
    ]),
  ])

  if (state.loading && state.sessions.length === 0 && !state.error) {
    page.append(el('div', { class: 'mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['加载中…'])]))
    return page
  }

  if (isSingleWs) {
    const presetRow = state.presets.length > 0
      ? el('label', { class: 'mobile-preset' }, [
          el('span', { class: 'mobile-presetLabel' }, ['Agent 模式']),
          el('select', {
            class: 'mobile-presetSelect',
            value: state.presetId,
            onchange: (ev) => { state.presetId = ev.target.value; render() },
          }, state.presets.map((p) => el('option', { value: p.id }, [p.name || p.id, p.isDefault ? '（默认）' : '']))),
        ])
      : null
    const presetEntry = state.presets.find((p) => p.id === state.presetId)
    page.append(el('div', { class: 'mobile-create mobile-pad' }, [
      presetRow,
      presetEntry?.description ? el('p', { class: 'mobile-presetDescription' }, [presetEntry.description]) : null,
      el('button', { type: 'button', class: 'mobile-new', disabled: state.creating, onclick: () => void createSession() }, [state.creating ? '创建中…' : '+ 新建会话']),
    ]))
    if (state.createError) page.append(el('p', { class: 'mobile-error mobile-pad' }, [state.createError]))
  }

  const list = el('ul', { class: 'mobile-list', onscroll: onListScroll })
  const sorted = getSortedSessions()
  for (const raw of sorted) {
    const s = decorateSession(raw)
    const ws = findWorkspaceForSession(s.sessionId) || state.workspace
    const wsName = ws ? workspaceTitle(ws) : ''
    list.append(el('li', {}, [
      el('button', {
        type: 'button',
        class: 'mobile-row',
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
        el('span', { class: 'mobile-chevron' }, ['›']),
      ]),
    ]))
  }
  page.append(list)

  if (state.hasMoreSessions) {
    page.append(el('div', { class: 'mobile-pad' }, [
      el('button', { type: 'button', class: 'mobile-button mobile-block', disabled: state.loadingMore, onclick: () => void loadMoreSessions() }, [state.loadingMore ? '加载中…' : '加载更多会话']),
    ]))
  }
  if (!state.hasMoreSessions && state.sessions.length === 0 && !state.loading) {
    page.append(el('div', { class: 'mobile-empty' }, [el('p', { class: 'mobile-muted' }, [isSingleWs ? '该工作区还没有会话，点上方按钮新建一个' : '暂无最近会话'])]))
  }
  return page
}
