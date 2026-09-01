/**
 * Workspaces view and quick-action cards.
 */
import { state, chat, runtime } from '../../state/state.js'
import { el, workspaceTitle, abbreviateHomePath } from '../../utils/dom.js'
import { formatTime, getTodayDateString } from '../../utils/time.js'
import { call, timedFetch } from '../../net/rpc.js'
import { renderQuotaBar } from '../../net/quota.js'
import { commitLocation, navBack, persistRoute } from '../../state/route.js'
import { headerIcon, themeToggle, reloadButton, headerActions, pwaButton, globalSettingsButton } from '../theme.js'
import { stopMuxObservation } from '../../net/mux.js'
import { render } from './render.js'
import { loadSessions } from './session-view.js'

export async function loadWorkspaces() {
    const data = await call('workspace.list', {})
    state.workspaces = data.items || []
  }

export async function loadPresets() {
    try {
      const data = await call('agentPreset.list', {})
      const presets = (data.presets || []).filter((p) => !p.broken)
      state.presets = presets
      state.presetId = (presets.find((p) => p.isDefault) || presets[0] || {}).id || ''
    } catch {
      state.presets = []
      state.presetId = ''
    }
  }

export async function openWorkspace(ws, opts = {}) {
    chatQuery += 1
    stopMuxObservation()
    state.workspace = ws
    state.view = 'sessions'
    state.session = null
    state.sessions = []
    state.cursor = undefined
    state.hasMoreSessions = false
    state.loadingMore = false
    state.createError = ''
    state.loading = true
    listScroll.top = 0
    const mode = opts.locationMode || 'push'
    if (mode !== 'none') commitLocation({ view: 'sessions', workspaceId: ws.workspaceId }, mode)
    else persistRoute({ view: 'sessions', workspaceId: ws.workspaceId })
    render()
    await loadSessions()
  }

export function showWorkspaces(locationMode = 'push') {
    chatQuery += 1
    stopMuxObservation()
    state.view = 'workspaces'
    state.workspace = null
    state.session = null
    state.loading = false
    if (locationMode !== 'none') commitLocation({ view: 'workspaces' }, locationMode)
    else persistRoute({ view: 'workspaces' })
    render()
  }

export function visibleWorkspaces() {
    const q = state.wsQuery.trim().toLowerCase()
    let list = state.workspaces.slice()
    if (q) {
      list = list.filter((ws) => {
        const name = workspaceTitle(ws)
        const path = ws.path || ''
        return name.toLowerCase().includes(q) || path.toLowerCase().includes(q)
      })
    }
    if (state.sortMode === 'recent') {
      list.sort((a, b) => {
        const sessionTimesA = (a.sessionIds || []).map(id => sessionLive.get(id)?.updatedAt || 0)
        const sessionTimesB = (b.sessionIds || []).map(id => sessionLive.get(id)?.updatedAt || 0)
        const maxA = sessionTimesA.length ? Math.max(...sessionTimesA) : (a.updatedAt || 0)
        const maxB = sessionTimesB.length ? Math.max(...sessionTimesB) : (b.updatedAt || 0)
        return maxB - maxA
      })
    }
    return list
  }

export function workspaceRow(ws) {
    const name = workspaceTitle(ws)
    const pathLabel = abbreviateHomePath(ws.path)
    return el('li', {}, [
      el('button', {
        type: 'button',
        class: 'mobile-row',
        title: ws.path || name,
        onclick: () => { void openWorkspace(ws) },
      }, [
        el('span', { class: 'mobile-rowStack' }, [
          el('span', { class: 'mobile-rowTitle' }, [name]),
          pathLabel && pathLabel !== name
            ? el('span', { class: 'mobile-rowMeta' }, [pathLabel])
            : null,
        ]),
        el('span', { class: 'mobile-chevron' }, ['›']),
      ]),
    ])
  }

export function renderWorkspaces() {
    const page = el('div', { class: 'mobile' }, [
      el('header', { class: 'mobile-header' }, [
        renderHeaderTabs(),
        headerActions([
          renderQuotaBar(),
          globalSettingsButton(),
        ]),
      ]),
    ])
    if (state.sheet === 'quota') page.append(quotaSheet())
    if (state.sheet === 'pwa') page.append(pwaSheet())
    if (state.sheet === 'settings') page.append(settingsSheet())
    if (state.sheet === 'power') page.append(powerSheet())
    if (state.createError) {
      page.append(el('p', { class: 'mobile-error' }, [state.createError]))
    }
    if (state.loading && state.workspaces.length === 0) {
      page.append(el('div', { class: 'mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['加载中…'])]))
      return page
    }

    const todayStr = getTodayDateString()
    const todayMatch = state.workspaces.find((w) => workspaceTitle(w) === todayStr || (w.path && w.path.endsWith(todayStr)))
    const quickCards = el('div', { class: 'mobile-quick-grid' }, [
      el('button', {
        type: 'button',
        class: 'mobile-quick-card is-today',
        disabled: state.creating,
        onclick: () => {
          if (todayMatch) {
            void openWorkspace(todayMatch)
          } else {
            void openToday()
          }
        },
      }, [
        el('div', { class: 'mobile-quick-icon' }, [
          headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/><rect x="10" y="13" width="4" height="4" rx="0.8" fill="currentColor" stroke="none"/></svg>')
        ]),
        el('div', { class: 'mobile-quick-info' }, [
          el('span', { class: 'mobile-quick-title' }, ['今日工作区']),
          el('span', { class: 'mobile-quick-desc' }, [todayMatch ? `${todayStr} · 已就绪` : `${todayStr} · 快速直达`]),
        ]),
        el('span', { class: 'mobile-chevron' }, ['›']),
      ]),
      el('button', {
        type: 'button',
        class: 'mobile-quick-card',
        onclick: () => enterDir(),
      }, [
        el('div', { class: 'mobile-quick-icon' }, [
          headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>')
        ]),
        el('div', { class: 'mobile-quick-info' }, [
          el('span', { class: 'mobile-quick-title' }, ['选择/新建工作区']),
          el('span', { class: 'mobile-quick-desc' }, ['浏览本地目录']),
        ]),
        el('span', { class: 'mobile-chevron' }, ['›']),
      ]),
    ])

    const search = el('input', {
      class: 'mobile-wsSearch',
      type: 'search',
      placeholder: '搜索工作区（名称或路径）',
      value: state.wsQuery,
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
      'aria-label': '搜索工作区',
      oninput: (ev) => {
        state.wsQuery = ev.target.value
        refreshWorkspaceList()
      },
      onkeydown: (ev) => {
        if (ev.key !== 'Enter') return
        const first = visibleWorkspaces()[0]
        if (first) {
          ev.preventDefault()
          void openWorkspace(first)
        }
      },
    })

    const list = el('ul', { class: 'mobile-list' })
    const empty = el('p', { class: 'mobile-muted mobile-wsSearchEmpty', hidden: true }, [''])
    const refreshWorkspaceList = () => {
      const q = state.wsQuery.trim()
      const visible = visibleWorkspaces()
      list.replaceChildren(...visible.map(workspaceRow))
      if (visible.length === 0) {
        empty.textContent = q ? `没有匹配「${q}」的工作区` : '还没有工作区'
        empty.hidden = false
      } else {
        empty.hidden = true
      }
    }
    refreshWorkspaceList()
    page.append(search, quickCards, list, empty)
    return page
  }

export async function probeToday() {
    try {
      const res = await timedFetch('/dsh-today/info', { credentials: 'same-origin' })
      state.todayAvailable = res.ok
    } catch {
      state.todayAvailable = false
    }
  }

export async function openToday() {
    if (state.creating) return
    state.creating = true
    state.createError = ''
    render()
    try {
      const res = await timedFetch('/dsh-today/open', { method: 'POST', credentials: 'same-origin' }, 20 * 1000)
      const data = await res.json()
      if (!res.ok || !data || typeof data.path !== 'string') {
        throw new Error((data && data.error) || '无法创建今天的工作区')
      }
      const result = await call('workspace.create', { path: data.path })
      await loadWorkspaces()
      await openWorkspace(result.workspace, { locationMode: 'replace' })
    } catch (err) {
      state.createError = String(err.message || err)
    } finally {
      state.creating = false
      if (state.view === 'workspaces') render()
    }
  }
