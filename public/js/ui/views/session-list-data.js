/**
 * Session data fetching, snapshot synchronization, and polling scheduler.
 */
import { state, runtime } from '../../state/state.js'
import { call } from '../../net/rpc.js'
import { hydrateSessionLive } from '../../net/pending.js'
import { triggerTaskDoneNotification } from '../../utils/notify.js'
import { commitLocation } from '../../state/route.js'
import { render } from './render.js'
import { loadWorkspaces } from './ws-view.js'

export const SESSION_PAGE = 30
export const LIST_POLL_MS = 25_000

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
  const q = ++runtime.sessionsQuery
  const listedAt = Date.now()
  const workspaceId = state.workspace && state.workspace.workspaceId
  const initial = state.sessions.length === 0
  if (initial) {
    state.loading = true
    if (state.view === 'sessions') render()
  }
  try {
    const workspaces = await call('workspace.list', {})
    if (q !== runtime.sessionsQuery) return
    const fresh = (workspaces.items || []).find((w) => w.workspaceId === workspaceId)
    const current = fresh || state.workspace
    state.workspace = current
    const page = await collectOwnedPages(workspaceId, ownedSessionIds(current), undefined, [], listedAt)
    if (q !== runtime.sessionsQuery) return
    state.sessions = page.items
    state.cursor = page.nextCursor
    state.hasMoreSessions = page.hasMore
  } catch (err) {
    if (q !== runtime.sessionsQuery) return
    state.error = String(err.message || err)
    state.view = 'error'
  } finally {
    if (q === runtime.sessionsQuery) {
      state.loading = false
      if (state.view === 'sessions' || state.view === 'error') render()
    }
  }
}

export function sessionStatusKey(items) {
  return (items || []).map((s) => {
    const row = runtime.sessionLive.get(s.sessionId)
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
  const token = ++runtime.liveQuery
  const listedAt = Date.now()
  try {
    const workspaces = await call('workspace.list', {})
    if (token !== runtime.liveQuery) return false
    const workspaceItems = workspaces.items || []
    if (state.view === 'workspaces') {
      const same = workspaceItems.length === state.workspaces.length
        && workspaceItems.every((w, i) => w.workspaceId === state.workspaces[i]?.workspaceId && w.title === state.workspaces[i]?.title)
      state.workspaces = workspaceItems
      if (!same) render()
      return !same
    }
    if (!state.workspace && state.view !== 'sessions') return false
    const workspaceId = state.workspace ? state.workspace.workspaceId : undefined
    if (state.workspace) {
      const fresh = workspaceItems.find((w) => w.workspaceId === workspaceId)
      if (fresh) state.workspace = fresh
    }
    const before = sessionStatusKey(state.sessions)
    const page = await collectOwnedPages(workspaceId, ownedSessionIds(state.workspace), undefined, [], listedAt)
    if (token !== runtime.liveQuery) return false
    if (state.view === 'sessions') mergeSessionsFromSnapshot(page.items)
    else {
      for (const item of page.items) hydrateSessionLive(item, listedAt)
    }
    let changed = before !== sessionStatusKey(state.view === 'sessions' ? state.sessions : page.items)
    if (state.view === 'chat' && state.session) {
      const row = runtime.sessionLive.get(state.session.sessionId)
      const next = row ? row.running === true : false
      if (state.running !== next) {
        const wasRunning = state.running
        state.running = next
        if (wasRunning && !next) triggerTaskDoneNotification(state.session?.title || '会话', state.session.sessionId)
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
  if (runtime.listPollTimer !== null) return
  runtime.listPollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    void refreshLiveSnapshot()
  }, LIST_POLL_MS)
}

export function stopListPoll() {
  if (runtime.listPollTimer !== null) {
    clearInterval(runtime.listPollTimer)
    runtime.listPollTimer = null
  }
}
