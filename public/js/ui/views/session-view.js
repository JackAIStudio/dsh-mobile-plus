/**
 * Sessions view with tabs, sorting, and live dot indicators.
 */
import { state, chat, runtime } from '../../state/state.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { formatTime } from '../../utils/time.js'
import { call } from '../../net/rpc.js'
import { commitLocation, navBack, persistRoute } from '../../state/route.js'
import { sessionStatusDot, hydrateSessionLive, decorateSession } from '../../net/pending.js'
import { renderQuotaBar } from '../../net/quota.js'
import { headerIcon, themeToggle, reloadButton, headerActions, pwaButton, todayButton, globalSettingsButton } from '../theme.js'
import { stopMuxObservation } from '../../net/mux.js'
import { render } from './render.js'
import { openChat } from './chat-view.js'

const SESSION_PAGE = 30
const LIST_POLL_MS = 5000

export function findWorkspaceForSession(sessionId) {
    if (!sessionId) return null
    for (const ws of state.workspaces || []) {
      if (ws.sessionIds && Array.isArray(ws.sessionIds) && ws.sessionIds.includes(sessionId)) {
        return ws
      }
    }
    return null
  }

export function switchListMode(mode) {
    state.listMode = mode
    try { localStorage.setItem('dsh-mp-list-mode', mode) } catch {}
    if (mode === 'flat') {
      state.workspace = null
      state.view = 'sessions'
      state.sessions = []
      state.cursor = undefined
      state.hasMoreSessions = false
      commitLocation({ view: 'sessions' }, 'replace')
      render()
      void loadSessions()
    } else {
      state.workspace = null
      state.view = 'workspaces'
      commitLocation({ view: 'workspaces' }, 'replace')
      render()
      void loadWorkspaces()
    }
  }

export function ownedSessionIds(workspace) {
    return new Set((workspace && workspace.sessionIds) || [])
  }

export function applySessionPage(items, owned, listedAt = 0, noFilter = false) {
    const rows = noFilter ? (items || []) : (items || []).filter((s) => owned.has(s.sessionId))
    for (const s of rows) hydrateSessionLive(s, listedAt)
    return rows
  }

export async function collectOwnedPages(workspaceId, owned, startCursor, already, listedAt = Date.now()) {
    const noFilter = !workspaceId
    if (!noFilter && owned.size === 0) return { items: already.slice(), nextCursor: undefined, hasMore: false }
    const items = already.slice()
    const seen = new Set(items.map((s) => s.sessionId))
    let cursor = startCursor
    let hasMore = startCursor === undefined || Boolean(startCursor)
    let hops = 0
    while (items.length < SESSION_PAGE && hasMore && hops < 40) {
      hops += 1
      const page = await call('session.list', {
        ...(cursor ? { cursor } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      })
      const extra = applySessionPage(page.items, owned, listedAt, noFilter)
      for (const row of extra) {
        if (seen.has(row.sessionId)) continue
        seen.add(row.sessionId)
        items.push(row)
      }
      const next = page.nextCursor
      if (next === cursor || !(page.items || []).length) {
        hasMore = false
        cursor = undefined
        break
      }
      cursor = next
      hasMore = Boolean(page.hasMore) && Boolean(cursor)
    }
    return { items, nextCursor: hasMore ? cursor : undefined, hasMore }
  }

export async function loadSessions() {
    const q = ++sessionsQuery
    const listedAt = Date.now()
    const workspaceId = state.workspace && state.workspace.workspaceId
    const initial = state.sessions.length === 0
    if (initial) {
      state.loading = true
      if (state.view === 'sessions') render()
    }
    try {
      const workspaces = await call('workspace.list', {})
      if (q !== sessionsQuery) return
      const fresh = (workspaces.items || []).find((w) => w.workspaceId === workspaceId)
      const current = fresh || state.workspace
      state.workspace = current
      const page = await collectOwnedPages(workspaceId, ownedSessionIds(current), undefined, [], listedAt)
      if (q !== sessionsQuery) return
      state.sessions = page.items
      state.cursor = page.nextCursor
      state.hasMoreSessions = page.hasMore
    } catch (err) {
      if (q !== sessionsQuery) return
      state.error = String(err.message || err)
      state.view = 'error'
    } finally {
      if (q === sessionsQuery) {
        state.loading = false
        if (state.view === 'sessions' || state.view === 'error') render()
      }
    }
  }

export function sessionStatusKey(items) {
    return (items || []).map((s) => {
      const row = sessionLive.get(s.sessionId)
      return `${s.sessionId}:${row?.running ? 1 : 0}:${s.updatedAt || 0}:${s.title || ''}`
    }).join('|')
  }

export function mergeSessionsFromSnapshot(items) {
    const byId = new Map((items || []).map((s) => [s.sessionId, s]))
    let changed = false
    const next = state.sessions.map((row) => {
      const fresh = byId.get(row.sessionId)
      if (!fresh) return row
      byId.delete(row.sessionId)
      if (row.running === fresh.running && row.updatedAt === fresh.updatedAt && row.title === fresh.title && row.blank === fresh.blank) return row
      changed = true
      return { ...row, ...fresh }
    })
    const newcomers = [...byId.values()]
    if (newcomers.length > 0) {
      changed = true
      next.push(...newcomers)
      next.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    }
    if (changed) state.sessions = next
    return changed
  }

export async function refreshLiveSnapshot() {
    if (state.view === 'boot' || state.view === 'pair' || state.view === 'error') return false
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
    const token = ++liveQuery
    const listedAt = Date.now()
    try {
      const workspaces = await call('workspace.list', {})
      if (token !== liveQuery) return false
      const workspaceItems = workspaces.items || []
      if (state.view === 'workspaces') {
        const same = workspaceItems.length === state.workspaces.length
          && workspaceItems.every((w, i) => w.workspaceId === state.workspaces[i]?.workspaceId && w.title === state.workspaces[i]?.title)
        state.workspaces = workspaceItems
        if (!same) render()
        return !same
      }
      if (!state.workspace) return false
      const workspaceId = state.workspace.workspaceId
      const fresh = workspaceItems.find((w) => w.workspaceId === workspaceId)
      if (fresh) state.workspace = fresh
      const before = sessionStatusKey(state.sessions)
      const page = await collectOwnedPages(workspaceId, ownedSessionIds(state.workspace), undefined, [], listedAt)
      if (token !== liveQuery) return false
      if (state.view === 'sessions') mergeSessionsFromSnapshot(page.items)
      else {
        for (const item of page.items) hydrateSessionLive(item, listedAt)
      }
      let changed = before !== sessionStatusKey(state.view === 'sessions' ? state.sessions : page.items)
      if (state.view === 'chat' && state.session) {
        const row = sessionLive.get(state.session.sessionId)
        const next = row ? row.running === true : false
        if (state.running !== next) {
          const wasRunning = state.running
          state.running = next
          if (wasRunning && !next) triggerTaskDoneNotification(state.session?.title || '会话')
          changed = true
        }
      }
      if (changed && (state.view === 'sessions' || state.view === 'chat')) render()
      return changed
    } catch {
      return false
    }
  }

export function startListPoll() {
    if (listPollTimer !== null) return
    listPollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refreshLiveSnapshot()
    }, LIST_POLL_MS)
  }

export function stopListPoll() {
    if (listPollTimer !== null) {
      clearInterval(listPollTimer)
      listPollTimer = null
    }
  }

export async function loadMoreSessions() {
    if (!state.cursor || state.loadingMore) return
    const q = sessionsQuery
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
      if (q !== sessionsQuery) return
      const seen = new Set(state.sessions.map((s) => s.sessionId))
      state.sessions = state.sessions.concat(page.items.filter((s) => !seen.has(s.sessionId)))
      state.cursor = page.nextCursor
      state.hasMoreSessions = page.hasMore
    } catch (err) {
      if (q !== sessionsQuery) return
      state.error = String(err.message || err)
    } finally {
      if (q === sessionsQuery) {
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
      // 无论成功/失败/超时都要复位按钮：卡在「创建中…」就是这里漏了兜底。
      state.creating = false
      if (state.view === 'sessions') render()
    }
  }

export function showSessionsFromChat(ws, locationMode) {
    chatQuery += 1
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
          onclick: () => switchListMode('workspace')
        }, ['工作区']),
        el('button', {
          type: 'button',
          class: state.listMode === 'flat' ? 'mobile-tab mobile-tabActive' : 'mobile-tab',
          onclick: () => switchListMode('flat')
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
    if (state.sheet === 'quota') page.append(quotaSheet())
    if (state.sheet === 'settings') page.append(settingsSheet())
    if (state.sheet === 'power') page.append(powerSheet())
    if (state.sheet === 'pwa') page.append(pwaSheet())

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
          }
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
