/**
 * Sessions view with tabs, sorting, and live dot indicators.
 */
import { state, runtime } from '../../state/state.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { onListScroll } from '../../utils/scroll.js'
import { sessionTitle } from '../../chat/fold.js'
import { commitLocation, persistRoute } from '../../state/route.js'
import { renderQuotaBar } from '../../net/quota.js'
import { headerIcon, headerActions, globalSettingsButton } from '../theme.js'
import { stopMuxObservation } from '../../net/mux.js'
import { render } from './render.js'
import { showWorkspaces } from './ws-view.js'
import { sessionRow } from './session-row.js'
import { createSession, createSessionInWorkspace, createTodaySession, renderPresetSelector } from './session-create.js'
import { openWorkspacePickerSheet } from '../sheets.js'
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
  createSession,
  createSessionInWorkspace,
  createTodaySession,
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

export function visibleSessions() {
  const q = (state.sessionQuery || '').trim().toLowerCase()
  const sorted = getSortedSessions()
  if (!q) return sorted
  return sorted.filter((s) => {
    const title = (s.blank ? '新会话' : sessionTitle(s)).toLowerCase()
    const ws = findWorkspaceForSession(s.sessionId) || state.workspace
    const wsName = ws ? workspaceTitle(ws).toLowerCase() : ''
    return title.includes(q) || wsName.includes(q)
  })
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
        ? el('button', {
            type: 'button',
            class: 'mobile-back',
            'aria-label': '返回',
            onclick: () => {
              if (state.listMode === 'flat') {
                void openRecentSessions({ locationMode: 'push' })
              } else {
                showWorkspaces('push')
              }
            },
          }, ['‹'])
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
    const presetKids = renderPresetSelector(render)
    page.append(el('div', { class: 'mobile-create mobile-pad' }, [
      ...presetKids,
      el('button', { type: 'button', class: 'mobile-new', disabled: state.creating, onclick: () => void createSession() }, [state.creating ? '创建中…' : '+ 新建会话']),
    ]))
    if (state.createError) page.append(el('p', { class: 'mobile-error mobile-pad' }, [state.createError]))
  }

  let search = null
  let quickActions = null
  if (!isSingleWs) {
    search = el('input', {
      class: 'mobile-wsSearch',
      type: 'search',
      placeholder: '搜索会话或所属工作区…',
      value: state.sessionQuery || '',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
      'aria-label': '搜索会话',
      oninput: (ev) => {
        state.sessionQuery = ev.target.value
        refreshSessionList()
      },
    })

    quickActions = el('div', { class: 'mobile-action-pills' }, [
      el('button', {
        type: 'button',
        class: 'mobile-action-pill is-today',
        disabled: state.creating,
        onclick: () => void createTodaySession(),
      }, [
        headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>'),
        el('span', {}, [state.creating && state.creatingWorkspaceId === 'today' ? '创建中…' : '今日新会话']),
      ]),
      el('button', {
        type: 'button',
        class: 'mobile-action-pill',
        disabled: state.creating,
        onclick: () => openWorkspacePickerSheet(),
      }, [
        headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>'),
        el('span', {}, ['选工作区新建…']),
      ]),
    ])
    if (state.createError) page.append(el('p', { class: 'mobile-error mobile-pad' }, [state.createError]))
  }

  const list = el('ul', { class: 'mobile-list', onscroll: onListScroll })
  const empty = el('p', { class: 'mobile-muted mobile-wsSearchEmpty', hidden: true }, [''])

  const refreshSessionList = () => {
    const q = (state.sessionQuery || '').trim()
    const visible = visibleSessions()
    list.replaceChildren(...visible.map((s) => sessionRow(s, isSingleWs)))
    if (visible.length === 0 && !state.loading) {
      empty.textContent = q ? `没有匹配「${q}」的会话` : (isSingleWs ? '该工作区还没有会话，点上方按钮新建一个' : '暂无最近会话')
      empty.hidden = false
    } else {
      empty.hidden = true
    }
  }

  refreshSessionList()

  if (search) page.append(search)
  if (quickActions) page.append(quickActions)
  page.append(list, empty)

  if (state.hasMoreSessions && !state.sessionQuery.trim()) {
    page.append(el('div', { class: 'mobile-pad' }, [
      el('button', { type: 'button', class: 'mobile-button mobile-block', disabled: state.loadingMore, onclick: () => void loadMoreSessions() }, [state.loadingMore ? '加载中…' : '加载更多会话']),
    ]))
  }
  return page
}
