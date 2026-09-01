/**
 * Hash router, deep-link persistence, and location state machine.
 */
import { state, chat, runtime, LOCATION_KEY } from './state.js'
import { openWorkspace, showWorkspaces } from '../ui/views/ws-view.js'
import { openChat } from '../ui/views/chat-view.js'
import { enterDir } from '../ui/views/dir-view.js'
import { render } from '../ui/views/render.js'

export function decodeRouteSeg(part) {
    try { return decodeURIComponent(part) } catch { return part }
  }

export function parseRoute(hash) {
    const source = hash === undefined ? window.location.hash : String(hash || '')
    const path = source.replace(/^#/, '').trim().replace(/^\/+|\/+$/g, '')
    if (path === '') return { view: 'workspaces', empty: true }
    const segs = path.split('/').map(decodeRouteSeg).filter(Boolean)
    if (segs.length === 1 && segs[0] === 'dir') return { view: 'dir' }
    if (segs[0] === 'ws' && segs[1]) {
      if (segs[2] === 's' && segs[3]) {
        return { view: 'chat', workspaceId: segs[1], sessionId: segs[3] }
      }
      if (segs.length === 2) return { view: 'sessions', workspaceId: segs[1] }
    }
    return { view: 'workspaces' }
  }

export function formatRoute(route) {
    if (!route || route.view === 'workspaces') return '#/'
    if (route.view === 'dir') return '#/dir'
    if (route.view === 'chat' && route.workspaceId && route.sessionId) {
      return `#/ws/${encodeURIComponent(route.workspaceId)}/s/${encodeURIComponent(route.sessionId)}`
    }
    if (route.workspaceId) return `#/ws/${encodeURIComponent(route.workspaceId)}`
    return '#/'
  }

export function persistRoute(route) {
    let saved = { view: state.listMode === 'flat' ? 'sessions' : 'workspaces', workspaceId: '' }
    if (route && route.view === 'chat' && route.workspaceId && route.sessionId) {
      saved = { view: 'chat', workspaceId: route.workspaceId, sessionId: route.sessionId }
    } else if (route && (route.view === 'sessions' || route.view === 'chat') && route.workspaceId) {
      saved = { view: 'sessions', workspaceId: route.workspaceId }
    }
    try { localStorage.setItem(LOCATION_KEY, JSON.stringify(saved)) } catch { /* privacy mode */ }
  }

export function readPersistedRoute() {
    try {
      const raw = localStorage.getItem(LOCATION_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : ''
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
      if (!workspaceId) return { view: state.listMode === 'flat' ? 'sessions' : 'workspaces', workspaceId: '' }
      if (parsed.view === 'sessions') return { view: 'sessions', workspaceId }
      if (sessionId && parsed.view !== 'workspaces') return { view: 'chat', workspaceId, sessionId }
      return { view: 'sessions', workspaceId }
    } catch {
      return null
    }
  }

export function commitLocation(route, mode) {
    const clean = {
      view: route && route.view ? route.view : 'workspaces',
      ...(route && route.workspaceId ? { workspaceId: route.workspaceId } : {}),
      ...(route && route.sessionId ? { sessionId: route.sessionId } : {}),
    }
    persistRoute(clean)
    if (mode === 'none') return
    const hash = formatRoute(clean)
    const url = `${window.location.pathname}${window.location.search}${hash}`
    const same = formatRoute(parseRoute(window.location.hash)) === hash
    const prevDepth = typeof history.state?.mpDepth === 'number' ? history.state.mpDepth : 0
    const rec = { mp: clean, mpDepth: (mode === 'push' && !same) ? prevDepth + 1 : prevDepth }
    ignoringPop = true
    try {
      if (mode === 'push' && !same) history.pushState(rec, '', url)
      else history.replaceState(rec, '', url)
    } catch {
      try { history.replaceState(rec, '', url) } catch { /* ignore */ }
    }
    ignoringPop = false
  }

export function reloadPaired() {
    const url = new URL(window.location.href)
    url.searchParams.delete('pair')
    window.location.replace(`${url.pathname}${url.search}${url.hash}`)
  }

export function locationModeFor(opts) {
    if (opts && opts.fromPopstate) return 'none'
    if (opts && opts.replace) return 'replace'
    return 'push'
  }

export function navBack(parent) {
    if (history.state && typeof history.state.mpDepth === 'number' && history.state.mpDepth > 0) {
      history.back()
      return
    }
    void applyRoute(parent, { replace: true })
  }

export async function applyRoute(route, opts = {}) {
    const gen = ++routeGen
    const locationMode = locationModeFor(opts)
    const still = () => gen === routeGen

    if (!route || route.view === 'workspaces' || (route.view !== 'dir' && route.view !== 'sessions' && route.view !== 'chat')) {
      showWorkspaces(locationMode)
      return
    }

    if (route.view === 'dir') {
      if (state.view === 'dir') {
        if (locationMode !== 'none') commitLocation({ view: 'dir' }, locationMode)
        else persistRoute({ view: 'dir' })
        return
      }
      enterDir(locationMode)
      return
    }

    const ws = (state.workspaces || []).find((item) => item.workspaceId === route.workspaceId)
    if (!ws) {
      showWorkspaces('replace')
      return
    }

    if (route.view === 'sessions' || !route.sessionId) {
      if (state.view === 'chat' && state.workspace?.workspaceId === ws.workspaceId) {
        showSessionsFromChat(ws, locationMode)
        return
      }
      if (state.view === 'sessions' && state.workspace?.workspaceId === ws.workspaceId) {
        if (locationMode !== 'none') commitLocation({ view: 'sessions', workspaceId: ws.workspaceId }, locationMode)
        else persistRoute({ view: 'sessions', workspaceId: ws.workspaceId })
        return
      }
      await openWorkspace(ws, { locationMode })
      return
    }

    if (state.view === 'chat' && state.session?.sessionId === route.sessionId && state.workspace?.workspaceId === ws.workspaceId) {
      if (locationMode !== 'none') commitLocation(route, locationMode)
      else persistRoute(route)
      return
    }

    const owned = ownedSessionIds(ws)
    if (owned.size > 0 && !owned.has(route.sessionId)) {
      if (!still()) return
      await applyRoute({ view: 'sessions', workspaceId: ws.workspaceId }, { replace: true })
      return
    }

    state.workspace = ws
    const listed = (state.sessions || []).find((item) => item.sessionId === route.sessionId)
    await openChat(listed || { sessionId: route.sessionId }, { locationMode })
  }

export async function restoreRoute() {
    const parsed = parseRoute(window.location.hash)
    const route = parsed.empty ? (readPersistedRoute() || { view: 'workspaces' }) : parsed
    await applyRoute(route, { replace: true })
    // Refresh replaces this history entry; parents on the stack may not be
    // ours. Zero depth so the in-app back button cannot history.back() off /mp/.
    if (history.state && history.state.mp) {
      ignoringPop = true
      try { history.replaceState({ ...history.state, mpDepth: 0 }, '', window.location.href) } catch { /* ignore */ }
      ignoringPop = false
    }
  }
