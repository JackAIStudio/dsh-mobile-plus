/**
 * dsh-mobile-plus — mobile page logic.
 *
 * This is a faithful port of the old plugin's mobile surface
 * (@linxin666/dsh-remote-web-ui/src/mobile/*) — same view state machine
 * (workspaces → sessions → chat), same markup/classes (mobileCss), same
 * markdown renderer — with TWO differences: the chat composer can attach
 * images (相册/拍照), sent images also land in the workspace's
 * .dsh-mobile-inbox/ via the host; and the current workspace/session is
 * addressable (`#/ws/:id/s/:id`) so a refresh or PWA relaunch returns
 * there instead of the workspace list.
 *
 * All data flows ride our own /mp/api RPC + /mp/api/events.mux
 * (chat) and /mp/api/events.host (session running / workspace membership).
 */
(() => {
  'use strict'

  /* ── state ─────────────────────────────────────────────────────────── */

  const state = {
    view: 'boot', // boot | pair | error | workspaces | sessions | chat | dir
    error: '',
    workspaces: [],
    sessions: [],
    presets: [],
    presetId: '',
    workspace: null,
    session: null,
    loading: true,
    loadingMore: false,
    creating: false,
    createError: '',
    cursor: undefined,
    hasMoreSessions: false,
    draft: '',
    images: [],
    sending: false,
    running: false,
    dir: null, // { path, home, crumbs, entries, truncated, ... }
    home: '', // host home from listDirectory, used to abbreviate workspace paths
    dirError: '',
    todayAvailable: false,
    sheet: null, // 'settings' | 'model' | 'quota' | null (bottom sheet)
    sheetReturn: null, // 'settings' when the model sheet was opened from 设置
  }

  /** Live chat fold state (independent of the view state). */
  const chat = {
    folder: null, // EventFolder (null until the first tail fold)
    messages: [], // current snapshot (incremental; never refetched wholesale)
    hasOlder: false,
    loading: true,
    tailLoading: true,
    liveBuffer: [], // events buffered while the initial tail page is in flight
    overflow: false, // liveBuffer hit its cap (oldest events were dropped)
    // Display preferences — same keys and defaults as the old plugin
    // (mobile/views/ChatView.tsx): tool calls shown, injected system
    // messages hidden by default, both persisted on the /mp origin.
    showToolCalls: readStoredBoolean('dsh.mobile.showToolCalls', true),
    showSystemMessages: readStoredBoolean('dsh.mobile.showSystemMessages', false),
    // Model picker state (old-plugin ModelSheet port): directory for the
    // open session; the current pick is shown inside 设置, not a composer chip.
    currentModel: undefined, // { provider, model, reasoningEffort? }
    modelSheet: { status: 'loading' }, // loading | ready{data} | error{message}
    modelBusy: false,
    modelError: undefined,
    // Standing todo list (Web TodoDock / 任务规划). Same lifetime as
    // dsh-tool-todo: latest todo/write with no later turn/start.
    todos: null, // null = unknown; [] = cleared this turn / never written
    // Mobile chrome is short: collapse by default and remember the last choice.
    todoCollapsed: readStoredBoolean('dsh.mobile.todoCollapsed', true),
    slashCommands: [],
    slashSkills: [],
    approvals: [],
    questions: [],
    // Local user bubbles shown immediately on send, before session.prompt
    // returns and before the mux echo arrives. Kept out of EventFolder so a
    // synthetic seq cannot poison the watermark.
    outbox: [],
  }

  /** DeepSeek 余额 + Grok 剩余额度（主机代理本机插件，密钥不进手机）。 */
  const QUOTA_DEBOUNCE_MS = 15 * 1000
  const quota = {
    status: 'idle', // idle | loading | ready
    deepseek: null,
    grok: null,
    lastFetchAt: 0,
    inFlight: null,
  }

  /** Read a boolean from localStorage defensively; falls back to the default. */
  function readStoredBoolean(key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return fallback
      return raw === '1' || raw.toLowerCase() === 'true'
    } catch {
      return fallback
    }
  }

  /** Persist a boolean toggle; storage failures are ignored (feature stays non-persistent). */
  function writeStoredBoolean(key, value) {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      /* quota / privacy mode: non-persistent is acceptable */
    }
  }

  /**
   * Deep-link the drill-down (workspaces → sessions → chat) so a refresh
   * lands on the same place. Hash routing avoids extra /mp/* server routes
   * and leaves `?pair=` alone. PWA start_url is still `/mp/`, so the last
   * non-wizard location is also mirrored to localStorage.
   *
   *   #/                              workspaces
   *   #/ws/:workspaceId               sessions
   *   #/ws/:workspaceId/s/:sessionId  chat
   *   #/dir                           directory picker (not persisted)
   */
  const LOCATION_KEY = 'dsh.mobile.location'
  let ignoringPop = false
  let routeGen = 0
  let chatQuery = 0

  function decodeRouteSeg(part) {
    try { return decodeURIComponent(part) } catch { return part }
  }

  function parseRoute(hash) {
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

  function formatRoute(route) {
    if (!route || route.view === 'workspaces') return '#/'
    if (route.view === 'dir') return '#/dir'
    if (route.view === 'chat' && route.workspaceId && route.sessionId) {
      return `#/ws/${encodeURIComponent(route.workspaceId)}/s/${encodeURIComponent(route.sessionId)}`
    }
    if (route.workspaceId) return `#/ws/${encodeURIComponent(route.workspaceId)}`
    return '#/'
  }

  function persistRoute(route) {
    let saved = { view: 'workspaces' }
    if (route && route.view === 'chat' && route.workspaceId && route.sessionId) {
      saved = { view: 'chat', workspaceId: route.workspaceId, sessionId: route.sessionId }
    } else if (route && (route.view === 'sessions' || route.view === 'chat') && route.workspaceId) {
      saved = { view: 'sessions', workspaceId: route.workspaceId }
    }
    try { localStorage.setItem(LOCATION_KEY, JSON.stringify(saved)) } catch { /* privacy mode */ }
  }

  function readPersistedRoute() {
    try {
      const raw = localStorage.getItem(LOCATION_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : ''
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
      if (!workspaceId) return { view: 'workspaces' }
      if (parsed.view === 'sessions') return { view: 'sessions', workspaceId }
      if (sessionId && parsed.view !== 'workspaces') return { view: 'chat', workspaceId, sessionId }
      return { view: 'sessions', workspaceId }
    } catch {
      return null
    }
  }

  function commitLocation(route, mode) {
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

  function stripPairQuery() {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('pair')) return
    url.searchParams.delete('pair')
    ignoringPop = true
    try {
      history.replaceState(history.state || {}, '', `${url.pathname}${url.search}${url.hash}`)
    } catch { /* ignore */ }
    ignoringPop = false
  }

  function locationModeFor(opts) {
    if (opts && opts.fromPopstate) return 'none'
    if (opts && opts.replace) return 'replace'
    return 'push'
  }

  function navBack(parent) {
    if (history.state && typeof history.state.mpDepth === 'number' && history.state.mpDepth > 0) {
      history.back()
      return
    }
    void applyRoute(parent, { replace: true })
  }

  let rpcN = 0
  let mux = null
  let host = null
  let pendingPoll = null
  let liveQuery = 0
  let listPollTimer = null
  let lastMsgScrollKey = null // last visible message id; null forces stick-to-bottom
  let svgUid = 0
  let prependAdjust = null // { height, top } captured before loadOlder

  /**
   * Per-session live status overlay, matching Web sidebar StateDot:
   * pending interaction (amber) > running (blue) > unviewed completion (green).
   */
  const sessionLive = new Map()

  /** Chat scroller restore across full-tree rerenders. */
  const chatScroll = {
    top: 0,
    stick: true,
    gen: 0,
    restoring: false,
  }

  /** Session-list scroll restore (live status rerenders used to jump to top). */
  const listScroll = { top: 0 }

  /** Todo-dock list restore — adding a row used to recreate the pane at scrollTop 0. */
  const todoScroll = { top: 0, stick: true }

  /* ── DOM helpers ───────────────────────────────────────────────────── */

  const rootEl = document.getElementById('root')

  function el(tag, attrs, kids) {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k === 'class') node.className = v
      else if (k === 'html') node.innerHTML = v
      else if (v === true) node.setAttribute(k, '')
      else if (v !== false && v != null && k !== 'value') node.setAttribute(k, String(v))
    }
    if ((tag === 'textarea' || tag === 'input' || tag === 'select') && attrs && 'value' in attrs) node.value = attrs.value
    for (const kid of kids || []) {
      if (kid == null || kid === false) continue
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
    }
    return node
  }

  function basename(path) {
    if (!path) return ''
    const parts = String(path).replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] || path
  }

  /**
   * Workspace display name, matching Web/PC: Host `title` (basename at create,
   * or a user rename). Absolute-path titles from stale records fall back to
   * the folder name so the row never leads with a full path.
   */
  function workspaceTitle(ws) {
    const title = typeof ws?.title === 'string' ? ws.title.trim() : ''
    if (title && !/[/\\]/.test(title)) return title
    return basename(ws?.path) || title || '工作区'
  }

  function isWindowsStylePath(value) {
    return /^[A-Za-z]:[/\\]/.test(value) || String(value).startsWith('\\\\')
  }

  /**
   * Display-only POSIX home abbreviation, same rules as Web `abbreviateHomePath`.
   * Prefer `state.home` from the directory picker; otherwise infer `/Users/…`
   * or `/home/…` from the path itself. Windows drive/UNC paths stay verbatim.
   */
  function abbreviateHomePath(path) {
    if (!path) return ''
    const raw = String(path)
    if (isWindowsStylePath(raw)) return raw
    const inferred = (raw.match(/^(\/(?:Users|home)\/[^/]+)/) || [])[1] || ''
    const home = String(state.home || inferred).replace(/\/+$/, '')
    if (!home || home === '/' || isWindowsStylePath(home)) return raw
    const trimmed = raw.replace(/\/+$/, '')
    if (trimmed === home) return '~'
    if (raw.startsWith(`${home}/`)) return `~${raw.slice(home.length)}`
    return raw
  }

  function formatTime(ms) {
    if (!ms) return ''
    const date = new Date(ms)
    const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    const today = new Date()
    if (date.toDateString() === today.toDateString()) return clock
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`
    return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
  }

  /* ── session status (Web sidebar StateDot) ─────────────────────────── */

  function ensureLive(sessionId) {
    let row = sessionLive.get(sessionId)
    if (!row) {
      row = {
        running: false,
        prevRunning: undefined,
        completed: false,
        liveAt: 0,
        pending: new Map(),
      }
      sessionLive.set(sessionId, row)
    }
    return row
  }

  function questionInteractionStatus(questions) {
    if (!Array.isArray(questions) || questions.length !== 1) return 'question'
    const question = questions[0]
    const intent = question && question.intent
    if (!intent || intent.kind !== 'plan-review' || question.detail === undefined) return 'question'
    if (question.multiSelect === true) return 'question'
    const options = question.options ?? []
    if (options.length > 2) return 'question'
    return options.some((option) => option.label === intent.approve) ? 'plan-review' : 'question'
  }

  function primaryPending(row) {
    let best
    for (const status of row.pending.values()) {
      if (status === 'approval') return 'approval'
      if (status === 'plan-review') best = 'plan-review'
      else if (best === undefined) best = status
    }
    return best
  }

  function pendingLabel(kind) {
    if (kind === 'approval') return '等待审批'
    if (kind === 'plan-review') return '计划待审'
    return '等待回答'
  }

  /**
   * Merge host session.list facts with the live overlay. First observation of
   * a running bit does not arm the green completion reminder (Web rule).
   * A mux/host frame newer than this snapshot wins; otherwise the list is
   * the reconciliation source — never leave a finished session spinning
   * just because turn/end was missed on the phone relay.
   */
  function hydrateSessionLive(item, listedAt = 0) {
    const row = ensureLive(item.sessionId)
    if (!Object.prototype.hasOwnProperty.call(item, 'running')) {
      if (row.prevRunning === undefined) row.prevRunning = row.running
      return
    }
    const listedRunning = item.running === true
    if (row.liveAt && listedAt && row.liveAt > listedAt) {
      if (row.prevRunning === undefined) row.prevRunning = row.running
      return
    }
    if (row.prevRunning === undefined) {
      row.running = listedRunning || row.running === true
      row.prevRunning = row.running
      return
    }
    row.running = listedRunning
    if (row.prevRunning && !row.running) {
      if (item.sessionId !== state.session?.sessionId) row.completed = true
    } else if (row.running) {
      row.completed = false
    }
    row.prevRunning = row.running
  }

  function decorateSession(item) {
    const row = sessionLive.get(item.sessionId)
    if (!row) return item
    return {
      ...item,
      running: row.running === true,
      completed: row.completed === true,
      pendingInteraction: primaryPending(row),
    }
  }

  function sessionStatusOf(item) {
    const pending = item.pendingInteraction
    if (pending) return { state: 'warning', label: pendingLabel(pending) }
    if (item.running) return { state: 'ongoing', label: '进行中' }
    if (item.completed) return { state: 'done', label: '已完成' }
    return null
  }

  function sessionStatusDot(item) {
    const status = sessionStatusOf(item)
    if (!status) return null
    if (status.state === 'ongoing') {
      const cells = [[0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4]]
      const rects = cells.map(([x, y], i) =>
        `<rect class="mobile-status-cell" x="${x}" y="${y}" width="2" height="2" style="animation-delay:${-1000 + i * 125}ms"></rect>`
      ).join('')
      return el('span', {
        class: 'mobile-status-ongoing',
        title: status.label,
        'aria-label': status.label,
        html: `<svg class="mobile-status-matrix" width="10" height="10" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`,
      })
    }
    return el('span', {
      class: `mobile-status-dot mobile-status-dot-${status.state}`,
      title: status.label,
      'aria-label': status.label,
    })
  }

  /**
   * Apply mux frames to the session-list overlay. Returns true when a visible
   * list row's status actually changed (so the sessions view should rerender).
   */
  function applySessionLive(frame) {
    if (!frame || typeof frame.type !== 'string' || typeof frame.sessionId !== 'string') return false
    const row = ensureLive(frame.sessionId)
    const before = `${row.running}|${row.completed}|${primaryPending(row) || ''}`
    if (frame.type === 'host/session-status') {
      const next = frame.running === true
      row.liveAt = Date.now()
      if (next) {
        row.running = true
        row.completed = false
        row.prevRunning = true
      } else {
        row.running = false
        if (row.prevRunning && frame.sessionId !== state.session?.sessionId) row.completed = true
        row.prevRunning = false
      }
    } else if (frame.type === 'session/event') {
      const ev = frame.event
      if (ev && ev.type === 'turn/start') {
        row.running = true
        row.completed = false
        row.prevRunning = true
        row.liveAt = Date.now()
      } else if (ev && ev.type === 'turn/end') {
        row.running = false
        if (row.prevRunning && frame.sessionId !== state.session?.sessionId) row.completed = true
        row.prevRunning = false
        row.liveAt = Date.now()
      }
    } else if (frame.type === 'approval/requested') {
      row.pending.set(`a:${frame.approvalId}`, 'approval')
    } else if (frame.type === 'approval/resolved') {
      row.pending.delete(`a:${frame.approvalId}`)
    } else if (frame.type === 'question/requested') {
      row.pending.set(`q:${frame.rpcId || frame.sessionId}`, questionInteractionStatus(frame.questions))
    } else if (frame.type === 'question/resolved') {
      row.pending.delete(`q:${frame.questionRpcId}`)
    }
    const after = `${row.running}|${row.completed}|${primaryPending(row) || ''}`
    return before !== after
  }

  /* ── todos / 任务规划 (Web TodoPanel glyphs) ───────────────────────── */

  function todoStatusOf(value) {
    if (value === 'completed' || value === 'done' || value === 'complete') return 'completed'
    if (value === 'in_progress' || value === 'in-progress' || value === 'running' || value === 'active') return 'in_progress'
    return 'pending'
  }

  function parseTodos(raw) {
    if (!raw) return null
    let parsed = raw
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw) } catch { return null }
    }
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' ? parsed.todos : null)
    if (!Array.isArray(list)) return null
    const out = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const content = typeof item.content === 'string' ? item.content : ''
      if (content === '') continue
      out.push({ content, status: todoStatusOf(item.status) })
    }
    return out.length > 0 ? out : null
  }

  function completedGlyph() {
    return el('span', {
      class: 'todo-glyph todo-glyph-completed',
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6.4" stroke="currentColor" stroke-width="1.2"/><path d="M10.9631 5.71411L7.70154 8.97571C7.48011 9.19714 7.27736 9.40099 7.09229 9.54993C6.89742 9.70669 6.66314 9.85279 6.3634 9.90027C6.2049 9.92534 6.04339 9.92534 5.88489 9.90027C5.58515 9.85279 5.35087 9.70669 5.15601 9.54993C4.97093 9.40099 4.76818 9.19714 4.54675 8.97571L3.03516 7.46411L3.96313 6.53613L5.47473 8.04773C5.7169 8.28989 5.86196 8.43389 5.97888 8.52795C6.08597 8.61409 6.10875 8.60701 6.08997 8.604C6.11259 8.60758 6.13571 8.60758 6.15833 8.604C6.13954 8.60701 6.16232 8.61409 6.26941 8.52795C6.38633 8.43389 6.53139 8.28989 6.77356 8.04773L10.0352 4.78613L10.9631 5.71411Z" fill="currentColor"/></svg>',
    })
  }

  function progressGlyph() {
    const id = `todo-grad-${++svgUid}`
    return el('span', {
      class: 'todo-glyph todo-glyph-progress',
      html: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="2.5" y1="12" x2="10.5" y2="3.5" gradientUnits="userSpaceOnUse"><stop stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><circle cx="7" cy="7" r="6.4" stroke="url(#${id})" stroke-width="1.2"/></svg>`,
    })
  }

  function pendingGlyph() {
    return el('span', {
      class: 'todo-glyph todo-glyph-pending',
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6.4" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.4 2.4"/></svg>',
    })
  }

  function statusGlyph(status) {
    if (status === 'completed') return completedGlyph()
    if (status === 'in_progress') return progressGlyph()
    return pendingGlyph()
  }

  function todoProgressLabel(todos) {
    const done = todos.filter((item) => item.status === 'completed').length
    const active = todos.filter((item) => item.status === 'in_progress').length
    const pending = todos.length - done - active
    const parts = []
    if (done > 0) parts.push(`${done} 已完成`)
    if (active > 0) parts.push(`${active} 进行中`)
    if (pending > 0) parts.push(`${pending} 待处理`)
    return parts.join(' · ')
  }

  function todoList(todos) {
    return el('ul', { class: 'todo-dock-list', onscroll: onTodoScroll }, todos.map((item) => (
      el('li', { class: 'todo-item', 'data-status': item.status }, [
        statusGlyph(item.status),
        el('span', { class: 'todo-content' }, [item.content]),
      ])
    )))
  }

  function checklistIcon() {
    return el('span', {
      class: 'todo-dock-lead',
      html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.6" y="1.6" width="14.8" height="14.8" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M4.6 9.3 7.1 11.8 13.4 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    })
  }

  function chevronIcon() {
    return el('span', {
      class: 'todo-dock-chevron',
      'aria-hidden': 'true',
      html: '<svg viewBox="0 0 20 20" fill="none"><path d="M4.4 7.4 10 13 15.6 7.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    })
  }

  /** Guard against pointerdown+click (or a replacement node eating the leftover click). */
  let todoToggleLock = 0

  function toggleTodoDock(ev) {
    if (ev) {
      ev.preventDefault()
      ev.stopPropagation()
    }
    const now = Date.now()
    if (now - todoToggleLock < 400) return
    todoToggleLock = now
    const next = chat.todoCollapsed !== true
    chat.todoCollapsed = next
    writeStoredBoolean('dsh.mobile.todoCollapsed', next)
    render()
  }

  function renderTodoDock(todos) {
    if (!todos || todos.length === 0) return null
    const collapsed = chat.todoCollapsed === true
    return el('section', {
      class: collapsed ? 'todo-dock is-collapsed' : 'todo-dock',
      'aria-label': '任务',
    }, [
      el('div', { class: 'todo-dock-body' }, [
        el('button', {
          type: 'button',
          class: 'todo-dock-header',
          'aria-expanded': String(!collapsed),
          'aria-label': collapsed ? '展开任务' : '收起任务',
          onpointerdown: toggleTodoDock,
          onclick: toggleTodoDock,
        }, [
          checklistIcon(),
          el('span', { class: 'todo-dock-title' }, ['任务']),
          el('span', { class: 'todo-dock-progress' }, [todoProgressLabel(todos)]),
          chevronIcon(),
        ]),
        collapsed ? null : todoList(todos),
      ]),
    ])
  }

  function renderTodoCard(todos) {
    return el('div', { class: 'chat-todo-card' }, [
      el('div', { class: 'todo-dock-header' }, [
        checklistIcon(),
        el('span', { class: 'todo-dock-title' }, ['更新任务清单']),
        el('span', { class: 'todo-dock-progress' }, [`${todos.filter((t) => t.status === 'completed').length}/${todos.length} 已完成`]),
      ]),
      todoList(todos),
    ])
  }

  function standingTodos() {
    return Array.isArray(chat.todos) ? chat.todos : []
  }

  /**
   * Web TodoDock lifetime (`dsh-tool-todo`): take each `todo/write` whole
   * list, and clear on `turn/start`. `turn/end` keeps the finished checklist.
   * A new turn must not keep showing the previous plan.
   */
  function applyStandingTodoEvent(list, ev) {
    if (!ev || typeof ev.type !== 'string') return list
    if (ev.type === 'turn/start') return []
    const data = isRecord(ev.data) ? ev.data : {}
    if (ev.type === 'todo/write') {
      const parsed = parseTodos(data.todos ?? data)
      return parsed || []
    }
    if (ev.type === 'tool/call' && pickString(data.name) === 'todo_write') {
      const parsed = parseTodos(pickArgs(data.arguments))
      return parsed || list
    }
    return list
  }

  function todosFromEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return null
    let standing = null
    let seen = false
    for (const entry of events) {
      const ev = toWireEvent(entry)
      if (!ev || typeof ev.type !== 'string') continue
      if (ev.type === 'turn/start') {
        standing = []
        seen = true
        continue
      }
      if (ev.type === 'todo/write') {
        const data = isRecord(ev.data) ? ev.data : {}
        standing = parseTodos(data.todos ?? data) || []
        seen = true
      }
    }
    return seen ? standing : null
  }

  function normalizeTodos(value) {
    if (!Array.isArray(value)) return null
    const out = []
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const content = typeof item.content === 'string' ? item.content : ''
      if (content === '') continue
      out.push({ content, status: todoStatusOf(item.status) })
    }
    return out
  }

  function todosFromProjections(page) {
    const values = page?.projections?.values
    if (!values || !Object.hasOwn(values, 'todos')) return null
    // Host sends null before the first write and again on each turn/start.
    // That is a real empty standing plan — do not resurrect an older list.
    return normalizeTodos(values.todos) ?? []
  }

  function projectionAsOfSeq(page) {
    return typeof page?.projections?.asOfSeq === 'number' ? page.projections.asOfSeq : undefined
  }

  function applyTodoEventsAfter(list, events, afterSeq) {
    let next = list
    if (!Array.isArray(events)) return next
    for (const entry of events) {
      const ev = toWireEvent(entry)
      if (!ev) continue
      if (typeof afterSeq === 'number' && typeof ev.seq === 'number' && ev.seq <= afterSeq) continue
      next = applyStandingTodoEvent(next, ev)
    }
    return next
  }

  /** Per-session seq watermark for the standing todos plan (higher-seq-wins). */
  const todoWatermark = new Map()

  function acceptTodoSeq(sessionId, seq) {
    if (typeof seq !== 'number') return true
    const prev = todoWatermark.get(sessionId)
    if (prev !== undefined && seq < prev) return false
    if (prev === undefined || seq > prev) todoWatermark.set(sessionId, seq)
    return true
  }

  function seedTodosFromPage(sessionId, page, extraEvents) {
    const projected = todosFromProjections(page)
    const asOf = projectionAsOfSeq(page)
    const base = projected !== null ? projected : (todosFromEvents(page?.events) ?? [])
    chat.todos = applyTodoEventsAfter(base, extraEvents, asOf)
    let floor = asOf
    if (Array.isArray(extraEvents)) {
      for (const entry of extraEvents) {
        const ev = toWireEvent(entry)
        if (typeof ev?.seq === 'number' && (floor === undefined || ev.seq > floor)) floor = ev.seq
      }
    }
    if (typeof floor === 'number') {
      const prev = todoWatermark.get(sessionId)
      if (prev === undefined || floor > prev) todoWatermark.set(sessionId, floor)
    }
  }

  function applyTodosProjection(sessionId, value, seq) {
    if (sessionId !== state.session?.sessionId) return false
    if (!acceptTodoSeq(sessionId, seq)) return false
    chat.todos = normalizeTodos(value) ?? []
    return true
  }

  function isStandingTodoEvent(ev) {
    if (!ev || typeof ev.type !== 'string') return false
    if (ev.type === 'turn/start' || ev.type === 'todo/write') return true
    if (ev.type !== 'tool/call') return false
    const data = isRecord(ev.data) ? ev.data : {}
    return pickString(data.name) === 'todo_write'
  }

  function applyTodosLiveEvent(sessionId, ev) {
    if (!isStandingTodoEvent(ev)) return false
    if (!acceptTodoSeq(sessionId, typeof ev.seq === 'number' ? ev.seq : undefined)) return false
    chat.todos = applyStandingTodoEvent(Array.isArray(chat.todos) ? chat.todos : [], ev)
    return true
  }

  /* ── chat scroll restore ───────────────────────────────────────────── */

  function nearBottom(node) {
    return node.scrollHeight - node.scrollTop - node.clientHeight < 80
  }

  function captureChatScroll() {
    const existing = document.querySelector('.chat-scroll')
    if (!existing || !existing.isConnected) return
    if (chatScroll.restoring) return
    chatScroll.top = existing.scrollTop
    chatScroll.stick = nearBottom(existing)
  }

  function onChatScroll(ev) {
    if (chatScroll.restoring) return
    const node = ev.currentTarget
    chatScroll.top = node.scrollTop
    chatScroll.stick = nearBottom(node)
  }

  /**
   * Apply the remembered chat scroll AFTER the new tree is in the document.
   * A generation token drops stale rAFs from the previous rebuild — those
   * used to no-op on a disconnected scroller and leave the new one at 0
   * (page jumps to the top on every live token / todo update).
   */
  function applyChatScroll(scroller) {
    if (!scroller) return
    const gen = ++chatScroll.gen
    chatScroll.restoring = true
    const apply = () => {
      if (gen !== chatScroll.gen || !scroller.isConnected) return
      if (prependAdjust) {
        const delta = scroller.scrollHeight - prependAdjust.height
        scroller.scrollTop = prependAdjust.top + delta
        chatScroll.top = scroller.scrollTop
        prependAdjust = null
        return
      }
      if (chatScroll.stick) {
        scroller.scrollTop = scroller.scrollHeight
        chatScroll.top = scroller.scrollTop
      } else {
        scroller.scrollTop = Math.min(chatScroll.top, scroller.scrollHeight)
      }
    }
    apply()
    requestAnimationFrame(() => {
      apply()
      requestAnimationFrame(() => {
        apply()
        if (gen === chatScroll.gen) chatScroll.restoring = false
      })
    })
    const imgs = scroller.querySelectorAll('img')
    for (const img of imgs) {
      if (img.complete) continue
      const settle = () => {
        if (gen !== chatScroll.gen || !scroller.isConnected || !chatScroll.stick) return
        scroller.scrollTop = scroller.scrollHeight
        chatScroll.top = scroller.scrollTop
      }
      img.addEventListener('load', settle, { once: true })
      img.addEventListener('error', settle, { once: true })
    }
  }

  function captureListScroll() {
    const existing = document.querySelector('.mobile-list')
    if (!existing || !existing.isConnected) return
    listScroll.top = existing.scrollTop
  }

  function onListScroll(ev) {
    listScroll.top = ev.currentTarget.scrollTop
  }

  function applyListScroll(list) {
    if (!list) return
    const top = listScroll.top
    list.scrollTop = top
    requestAnimationFrame(() => {
      if (list.isConnected) list.scrollTop = top
    })
  }

  function captureTodoScroll() {
    const existing = document.querySelector('.todo-dock-list')
    if (!existing || !existing.isConnected) return
    todoScroll.top = existing.scrollTop
    todoScroll.stick = nearBottom(existing)
  }

  function onTodoScroll(ev) {
    const node = ev.currentTarget
    todoScroll.top = node.scrollTop
    todoScroll.stick = nearBottom(node)
  }

  function applyTodoScroll(list) {
    if (!list) return
    if (todoScroll.stick) list.scrollTop = list.scrollHeight
    else list.scrollTop = Math.min(todoScroll.top, list.scrollHeight)
    requestAnimationFrame(() => {
      if (!list.isConnected) return
      if (todoScroll.stick) list.scrollTop = list.scrollHeight
      else list.scrollTop = Math.min(todoScroll.top, list.scrollHeight)
    })
  }

  /**
   * Stop iOS/Android pull-to-refresh and document rubber-banding. Nested
   * panes still scroll; only the chain past their top/bottom is cancelled.
   */
  function scrollableAncestor(node) {
    let el = node
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.nodeType === 1) {
        const tag = el.tagName
        if (tag === 'TEXTAREA' && el.scrollHeight > el.clientHeight + 1) return el
        const oy = window.getComputedStyle(el).overflowY
        if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1) {
          return el
        }
      }
      el = el.parentElement
    }
    return null
  }

  function installOverscrollLock() {
    let startY = 0
    document.addEventListener('touchstart', (ev) => {
      if (ev.touches.length === 1) startY = ev.touches[0].clientY
    }, { passive: true, capture: true })
    document.addEventListener('touchmove', (ev) => {
      if (ev.touches.length !== 1) return
      const dy = ev.touches[0].clientY - startY
      const pane = scrollableAncestor(ev.target)
      if (!pane) {
        ev.preventDefault()
        return
      }
      const atTop = pane.scrollTop <= 0
      const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1
      if ((atTop && dy > 0) || (atBottom && dy < 0)) ev.preventDefault()
    }, { passive: false, capture: true })
  }

  function pinViewport() {
    const root = document.documentElement
    const body = document.body
    let ticking = false

    const apply = () => {
      ticking = false
      const vv = window.visualViewport
      const height = vv ? vv.height : window.innerHeight
      const width = vv ? vv.width : window.innerWidth
      const offsetTop = vv ? vv.offsetTop : 0
      const offsetLeft = vv ? vv.offsetLeft : 0
      // iOS keeps innerHeight at the layout size when the keyboard is up;
      // the visual viewport is what actually shrinks (and often shifts).
      const kbOpen = (window.innerHeight - height) > 80 || offsetTop > 0

      // Size the fixed body only. Shrinking <html> itself can make iOS
      // revise the layout viewport and retrigger visualViewport resize.
      body.style.height = `${height}px`
      body.style.width = `${width}px`
      // Glue the fixed page to the visual viewport. A height-only pin
      // leaves the composer at the top of the layout viewport (or
      // off-screen) while iOS caret-scrolls offsetTop — the empty gap
      // + floating overlay the phone remote shows on focus.
      body.style.transform = `translate(${offsetLeft}px, ${offsetTop}px)`
      if (kbOpen) root.dataset.keyboard = '1'
      else delete root.dataset.keyboard
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
    }

    const schedule = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(apply)
    }

    const afterKeyboard = () => {
      schedule()
      requestAnimationFrame(schedule)
      setTimeout(schedule, 50)
      setTimeout(schedule, 300)
    }

    apply()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('orientationchange', afterKeyboard)
    window.addEventListener('focusin', afterKeyboard)
    window.addEventListener('focusout', afterKeyboard)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule)
      window.visualViewport.addEventListener('scroll', schedule)
    }
  }

  /* ── theme toggle (ported from mobile/theme-toggle.tsx) ─────────────── */

  const THEME_KEY = 'dsh-mobile-plus-theme'

  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY) } catch { return null }
  }

  function applyTheme() {
    document.documentElement.dataset.theme = storedTheme() === 'dark' ? 'dark' : ''
  }

  function toggleTheme() {
    const next = storedTheme() === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem(THEME_KEY, next) } catch { /* ignore */ }
    applyTheme()
    render()
  }

  function headerIcon(markup) {
    // innerHTML so the browser parses real SVG namespace nodes.
    // createElement('svg') stays in the HTML namespace and paints nothing.
    return el('span', { class: 'mobile-header-icon', 'aria-hidden': 'true', html: markup })
  }

  function themeToggle() {
    const dark = storedTheme() === 'dark'
    return el('button', {
      type: 'button', class: 'mobile-theme-toggle',
      'aria-label': dark ? '切换到浅色' : '切换到深色',
      onclick: toggleTheme,
    }, [
      headerIcon(dark
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>'),
    ])
  }

  /** Chat-only header control: model / display / context live in one sheet. */
  function settingsButton() {
    const pct = contextUsage()
    const warn = pct !== undefined && pct >= 80
    const open = state.sheet === 'settings' || state.sheet === 'model' || state.sheet === 'quota'
    return el('button', {
      type: 'button',
      class: 'mobile-settings-btn',
      'aria-label': warn ? `设置，上下文已用 ${pct}%` : '设置',
      'aria-haspopup': 'dialog',
      'aria-expanded': open ? 'true' : 'false',
      onclick: () => {
        state.sheetReturn = null
        state.sheet = state.sheet === 'settings' ? null : 'settings'
        render()
      },
    }, [
      headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>'),
      el('span', { class: 'mobile-settings-label' }, ['设置']),
      warn ? el('span', { class: 'mobile-settings-dot', 'aria-hidden': 'true' }) : null,
    ])
  }

  /* ── markdown (ported from mobile/markdown.ts, GFM subset) ─────────── */

  const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char)
  }

  function safeUrl(raw) {
    const trimmed = raw.trim()
    if (trimmed === '') return null
    if (trimmed.startsWith('#')) return trimmed
    if (trimmed.startsWith('//')) return null
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
    if (scheme === null) return trimmed
    const name = scheme[1].toLowerCase()
    return name === 'http' || name === 'https' || name === 'mailto' ? trimmed : null
  }

  function findCloseParen(text, from) {
    let depth = 0
    for (let i = from; i < text.length; i += 1) {
      const char = text[i]
      if (char === '(') depth += 1
      else if (char === ')') {
        if (depth === 0) return i
        depth -= 1
      }
    }
    return -1
  }

  function renderInline(text) {
    let out = ''
    let i = 0
    const n = text.length
    while (i < n) {
      const char = text[i]
      if (char === '`') {
        const end = text.indexOf('`', i + 1)
        if (end !== -1) {
          out += '<code>' + escapeHtml(text.slice(i + 1, end)) + '</code>'
          i = end + 1
          continue
        }
      }
      if (char === '!' && text[i + 1] === '[') {
        const close = text.indexOf('](', i + 2)
        if (close !== -1) {
          const parenEnd = findCloseParen(text, close + 2)
          if (parenEnd !== -1) {
            const alt = text.slice(i + 2, close)
            const src = text.slice(close + 2, parenEnd)
            const safe = safeUrl(src)
            if (safe === null) out += escapeHtml(alt)
            else {
              const srcEsc = escapeHtml(safe).replace(/\s+/g, '%20')
              out += '<img alt="' + escapeHtml(alt) + '" src="' + srcEsc + '" />'
            }
            i = parenEnd + 1
            continue
          }
        }
      }
      if (char === '[') {
        const close = text.indexOf('](', i + 1)
        if (close !== -1) {
          const parenEnd = findCloseParen(text, close + 2)
          if (parenEnd !== -1) {
            const label = text.slice(i + 1, close)
            const href = text.slice(close + 2, parenEnd)
            const safe = safeUrl(href)
            if (safe === null) out += renderInline(label)
            else out += '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + renderInline(label) + '</a>'
            i = parenEnd + 1
            continue
          }
        }
      }
      if (char === '*' && text[i + 1] === '*') {
        const end = text.indexOf('**', i + 2)
        if (end !== -1) {
          out += '<strong>' + renderInline(text.slice(i + 2, end)) + '</strong>'
          i = end + 2
          continue
        }
      }
      if (char === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
        const end = text.indexOf('*', i + 1)
        if (end !== -1 && text[end + 1] !== '*') {
          out += '<em>' + renderInline(text.slice(i + 1, end)) + '</em>'
          i = end + 1
          continue
        }
      }
      if (char === '~' && text[i + 1] === '~') {
        const end = text.indexOf('~~', i + 2)
        if (end !== -1) {
          out += '<del>' + renderInline(text.slice(i + 2, end)) + '</del>'
          i = end + 2
          continue
        }
      }
      out += escapeHtml(char)
      i += 1
    }
    return out
  }

  function splitTableRow(line) {
    const trimmed = line.trim()
    const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
    const withoutTrailing = inner.endsWith('|') ? inner.slice(0, -1) : inner
    return withoutTrailing.split('|').map((cell) => cell.trim())
  }

  function renderMarkdown(source) {
    const lines = source.replace(/\r\n/g, '\n').split('\n')
    const out = []
    let i = 0
    const n = lines.length

    const flushParagraph = (buffer) => {
      if (buffer.length === 0) return
      out.push('<p>' + renderInline(buffer.join('\n')) + '</p>')
      buffer.length = 0
    }

    let paragraph = []
    while (i < n) {
      const line = lines[i]

      const fence = /^```([\w+-]*)\s*$/.exec(line)
      if (fence !== null) {
        flushParagraph(paragraph)
        const lang = fence[1] ?? ''
        i += 1
        const code = []
        while (i < n && !/^```\s*$/.test(lines[i])) {
          code.push(lines[i])
          i += 1
        }
        i += 1
        const langAttr = lang === '' ? '' : ' class="language-' + escapeHtml(lang) + '"'
        out.push('<pre' + langAttr + '><code>' + escapeHtml(code.join('\n')) + '</code></pre>')
        continue
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line)
      if (heading !== null) {
        flushParagraph(paragraph)
        const level = heading[1].length
        out.push('<h' + level + '>' + renderInline(heading[2] ?? '') + '</h' + level + '>')
        i += 1
        continue
      }

      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        flushParagraph(paragraph)
        out.push('<hr />')
        i += 1
        continue
      }

      if (line.includes('|') && i + 1 < n && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        flushParagraph(paragraph)
        const headerCells = splitTableRow(line)
        i += 2
        const rows = []
        while (i < n && lines[i].includes('|')) {
          rows.push(splitTableRow(lines[i]))
          i += 1
        }
        out.push('<table>')
        out.push('<thead><tr>' + headerCells.map((cell) => '<th>' + renderInline(cell) + '</th>').join('') + '</tr></thead>')
        if (rows.length > 0) {
          out.push('<tbody>' + rows.map((row) => '<tr>' + row.map((cell) => '<td>' + renderInline(cell) + '</td>').join('') + '</tr>').join('') + '</tbody>')
        }
        out.push('</table>')
        continue
      }

      const quote = /^>\s?(.*)$/.exec(line)
      if (quote !== null) {
        flushParagraph(paragraph)
        const body = []
        while (i < n) {
          const q = /^>\s?(.*)$/.exec(lines[i])
          if (q === null) break
          body.push(q[1] ?? '')
          i += 1
        }
        out.push('<blockquote><p>' + body.map((bodyLine) => renderInline(bodyLine)).join('<br />') + '</p></blockquote>')
        continue
      }

      const ul = /^\s*([-*+])\s+(.*)$/.exec(line)
      if (ul !== null) {
        flushParagraph(paragraph)
        const items = []
        while (i < n) {
          const item = /^\s*([-*+])\s+(.*)$/.exec(lines[i])
          if (item === null) break
          items.push('<li>' + renderInline(item[2] ?? '') + '</li>')
          i += 1
        }
        out.push('<ul>' + items.join('') + '</ul>')
        continue
      }

      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
      if (ol !== null) {
        flushParagraph(paragraph)
        const items = []
        while (i < n) {
          const item = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
          if (item === null) break
          items.push('<li>' + renderInline(item[1] ?? '') + '</li>')
          i += 1
        }
        out.push('<ol>' + items.join('') + '</ol>')
        continue
      }

      if (line.trim() === '') {
        flushParagraph(paragraph)
        i += 1
        continue
      }

      paragraph.push(line)
      i += 1
    }
    flushParagraph(paragraph)
    return out.join('\n')
  }

  /* ── RPC (our own /mp/api) ─────────────────────────────────────────── */

  function rpcId() {
    return `${Date.now().toString(36)}-${++rpcN}`
  }

  async function call(method, payload) {
    const id = rpcId()
    const res = await fetch(`/mp/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload }),
    })
    if (res.status === 403) {
      // 403 有两种（读 body 区分，避免一律显示 "unpaired"）：
      // - error.code === 'forbidden'：方法不在宿主端白名单里 —— 宿主端插件
      //   还是旧版本（老插件 staleHostHint 的同款提示）
      // - 其它：此设备配对失效
      let code
      try {
        const body = await res.json()
        code = body?.error?.code
      } catch { /* non-JSON body */ }
      const err = new Error(code === 'forbidden'
        ? '宿主端插件可能是旧版本：请重启 dsh web 后再试。'
        : '此设备未配对：请在电脑端重新生成配对链接。')
      err.code = 'unpaired'
      throw err
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const envelope = await res.json()
    if (envelope?.result?.ok === true) return envelope.result.value
    throw new Error(envelope?.result?.error?.message || '请求失败')
  }

  function formatMoney(currency, amount) {
    if (!Number.isFinite(amount)) return '—'
    const body = amount.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    if (currency === 'CNY') return '¥' + body
    if (currency === 'USD') return '$' + body
    return body + ' ' + currency
  }

  function pickPrimaryBalance(balances) {
    if (!Array.isArray(balances) || balances.length === 0) return null
    return balances.find((row) => row.currency === 'CNY')
      || balances.find((row) => row.currency === 'USD')
      || balances[0]
      || null
  }

  function grokUsedPercent(usage) {
    if (!usage || !Array.isArray(usage.windows)) return undefined
    const total = usage.windows.find((row) => row.id === 'SuperGrok' || row.id === 'weekly')
    if (total && total.unit === 'percent') return total.used
    const products = usage.windows.filter((row) => row.id !== 'SuperGrok' && row.id !== 'weekly')
    if (products.length > 0 && products.every((row) => row.unit === 'percent')) {
      return Math.min(100, Math.round(products.reduce((sum, row) => sum + row.used, 0) * 10) / 10)
    }
    return undefined
  }

  function grokRemainingPercent(usage) {
    const used = grokUsedPercent(usage)
    if (used === undefined) return undefined
    return Math.max(0, Math.round((100 - used) * 10) / 10)
  }

  function grokWindowLabel(id) {
    if (id === 'SuperGrok' || id === 'weekly') return 'SuperGrok'
    if (id === 'GrokBuild') return 'Build'
    if (id === 'GrokImagine') return 'Imagine'
    if (id === 'GrokAppBuilder') return 'App Builder'
    return id
  }

  function formatQuotaClock(value) {
    const ms = typeof value === 'number' ? value : Date.parse(value)
    if (!Number.isFinite(ms)) return ''
    try {
      return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    } catch {
      return ''
    }
  }

  function formatQuotaStamp(iso) {
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) return iso
    const pad = (n) => String(n).padStart(2, '0')
    return `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`
  }

  function deepseekView() {
    const row = quota.deepseek
    if (!row || row.present === false) return null
    const primary = pickPrimaryBalance(row.balances)
    const loading = quota.status === 'loading'
    if (primary) {
      const low = primary.currency === 'USD' ? primary.total < 1 : primary.total < 5
      return {
        amount: formatMoney(primary.currency, primary.total),
        kind: low ? 'warn' : 'ready',
        loading,
        primary,
        available: row.available !== false,
        fetchedAt: row.fetchedAt,
        balances: row.balances,
      }
    }
    if (row.ok === false) {
      return {
        amount: row.code === 'missing-key' ? '未配置' : '查不到',
        kind: row.code === 'missing-key' ? 'muted' : 'error',
        loading,
        error: row.error,
        code: row.code,
      }
    }
    if (quota.status === 'ready') return { amount: '无余额', kind: 'muted', loading }
    return { amount: '查询中', kind: 'muted', loading: true }
  }

  function grokView() {
    const row = quota.grok
    if (!row || row.present === false) return null
    if (row.status === 'logged-out' || row.status === 'unsupported') return null
    const remaining = grokRemainingPercent(row.usage)
    const used = grokUsedPercent(row.usage)
    const loading = quota.status === 'loading'
    if (remaining === undefined) {
      if (row.ok === false) return { amount: '查不到', kind: 'error', loading, error: row.error }
      return null
    }
    const kind = remaining <= 5 ? 'alert' : remaining <= 20 ? 'warn' : 'ready'
    return {
      amount: `还剩 ${remaining}%`,
      remaining,
      used,
      kind,
      loading,
      usage: row.usage,
    }
  }

  function quotaSummary() {
    const parts = []
    const ds = deepseekView()
    const gk = grokView()
    if (ds) parts.push(`DeepSeek ${ds.amount}`)
    if (gk) parts.push(`Grok ${gk.amount}`)
    return parts.length ? parts.join(' · ') : '点击查询本机额度'
  }

  function loadQuota(force) {
    if (quota.inFlight) return quota.inFlight
    if (!force && quota.lastFetchAt > 0 && Date.now() - quota.lastFetchAt < QUOTA_DEBOUNCE_MS && quota.status === 'ready') {
      return Promise.resolve()
    }
    const hadSnapshot = quota.status === 'ready'
    quota.status = 'loading'
    if (hadSnapshot) renderQuotaIfVisible()
    quota.inFlight = call('quota.read', force ? { force: true } : {}).then((value) => {
      quota.inFlight = null
      quota.lastFetchAt = Date.now()
      quota.deepseek = value && value.deepseek ? value.deepseek : null
      quota.grok = value && value.grok ? value.grok : null
      quota.status = 'ready'
      renderQuotaIfVisible()
    }, () => {
      quota.inFlight = null
      quota.lastFetchAt = Date.now()
      quota.status = 'ready'
      renderQuotaIfVisible()
    })
    return quota.inFlight
  }

  function renderQuotaIfVisible() {
    if (state.view === 'chat' || state.view === 'workspaces' || state.view === 'sessions' || state.sheet === 'quota') {
      render()
    }
  }

  function openQuotaSheet() {
    if (state.sheet === 'settings') state.sheetReturn = 'settings'
    state.sheet = 'quota'
    render()
    void loadQuota(true)
  }

  function closeQuotaSheet() {
    state.sheet = state.sheetReturn || null
    state.sheetReturn = null
    render()
  }

  function renderQuotaBar() {
    const ds = deepseekView()
    const gk = grokView()
    if (!ds && !gk) return null
    const chip = (view, label) => el('button', {
      type: 'button',
      class: [
        'chat-quota-chip',
        view.loading ? 'is-loading' : '',
        view.kind === 'warn' ? 'is-warn' : '',
        view.kind === 'alert' || view.kind === 'error' ? 'is-alert' : '',
      ].filter(Boolean).join(' '),
      'aria-label': `${label} ${view.amount}，点击查看详情`,
      onclick: () => openQuotaSheet(),
    }, [
      el('span', { class: 'chat-quota-label' }, [label]),
      el('span', { class: 'chat-quota-value' }, [view.amount]),
    ])
    return el('div', { class: 'chat-quota', 'aria-label': '账户额度' }, [
      ds ? chip(ds, 'DeepSeek') : null,
      gk ? chip(gk, 'Grok') : null,
    ])
  }

  function quotaSheet() {
    const ds = deepseekView()
    const gk = grokView()
    const dsBody = !ds
      ? el('div', { class: 'quota-section' }, [
          el('div', { class: 'quota-section-head' }, [el('span', { class: 'quota-section-title' }, ['DeepSeek'])]),
          el('p', { class: 'quota-hint' }, ['未安装余额插件，或本机暂不可查。']),
        ])
      : el('div', { class: 'quota-section' }, [
          el('div', { class: 'quota-section-head' }, [el('span', { class: 'quota-section-title' }, ['DeepSeek 余额'])]),
          el('p', { class: `quota-hero${ds.kind === 'warn' ? ' is-warn' : ds.kind === 'error' ? ' is-error' : ''}` }, [ds.amount]),
          ds.primary
            ? el('p', { class: 'quota-meta' }, [
                `充值 ${formatMoney(ds.primary.currency, ds.primary.toppedUp)} · 赠送 ${formatMoney(ds.primary.currency, ds.primary.granted)}`,
              ])
            : null,
          ds.fetchedAt ? el('p', { class: 'quota-hint' }, [`更新于 ${formatQuotaClock(ds.fetchedAt)}`]) : null,
          ds.available === false ? el('p', { class: 'quota-error' }, ['账号当前不可用']) : null,
          ds.error ? el('p', { class: 'quota-error' }, [ds.error]) : null,
        ])
    const products = (gk && gk.usage && Array.isArray(gk.usage.windows) ? gk.usage.windows : [])
      .filter((row) => row.id !== 'SuperGrok' && row.id !== 'weekly')
    const productLine = products.length
      ? products.map((row) => `${grokWindowLabel(row.id)} ${row.used}%`).join(' · ')
      : ''
    const resetAt = gk && gk.usage && gk.usage.windows && gk.usage.windows[0] && gk.usage.windows[0].resetsAt
    const gkBody = !gk
      ? el('div', { class: 'quota-section' }, [
          el('div', { class: 'quota-section-head' }, [el('span', { class: 'quota-section-title' }, ['Grok'])]),
          el('p', { class: 'quota-hint' }, ['未登录 Grok，或本机暂不可查。']),
        ])
      : el('div', { class: 'quota-section' }, [
          el('div', { class: 'quota-section-head' }, [el('span', { class: 'quota-section-title' }, ['Grok 剩余额度'])]),
          el('p', { class: `quota-hero${gk.kind === 'warn' ? ' is-warn' : gk.kind === 'alert' || gk.kind === 'error' ? ' is-alert' : ''}` }, [gk.amount]),
          gk.used !== undefined ? el('p', { class: 'quota-meta' }, [`本周已使用 ${gk.used}%`]) : null,
          productLine ? el('p', { class: 'quota-meta' }, [productLine]) : null,
          resetAt ? el('p', { class: 'quota-hint' }, [`重置 ${formatQuotaStamp(resetAt)}`]) : null,
          gk.usage && gk.usage.fetchedAt ? el('p', { class: 'quota-hint' }, [`更新于 ${formatQuotaClock(gk.usage.fetchedAt)}`]) : null,
          gk.error ? el('p', { class: 'quota-error' }, [gk.error]) : null,
        ])
    return el('div', { class: 'sheet-backdrop', onclick: () => closeQuotaSheet() }, [
      el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '账户额度', onclick: (ev) => { ev.stopPropagation() } }, [
        el('div', { class: 'sheet-handle' }),
        el('div', { class: 'sheet-title quota-sheet-title' }, [
          el('span', null, ['账户额度']),
          el('button', {
            type: 'button',
            class: 'quota-refresh',
            disabled: quota.status === 'loading',
            onclick: () => { void loadQuota(true) },
          }, [quota.status === 'loading' ? '刷新中…' : '刷新']),
        ]),
        el('div', { class: 'sheet-body' }, [dsBody, gkBody]),
      ]),
    ])
  }

  /* ── pairing (ported from mobile/pairing.ts, /mp flavor) ───────────── */

  function parsePairInput(value) {
    const trimmed = (value || '').trim()
    if (trimmed === '') return undefined
    try {
      const url = new URL(trimmed, window.location.origin)
      const token = url.searchParams.get('pair')
      if (token) return token
    } catch {
      /* raw token or relative query */
    }
    if (/^[a-f0-9]{32}$/i.test(trimmed)) return trimmed
    return undefined
  }

  async function acceptPair(token) {
    const res = await fetch('/mp/pair/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token }),
    })
    if (res.ok) return undefined
    if (res.status === 404) return '配对链接无效或已过期。'
    if (res.status === 409) return '配对链接已被使用。'
    return '此设备无法使用该配对链接。'
  }

  async function pairStatus() {
    try {
      const res = await fetch('/mp/pair/status', { credentials: 'same-origin' })
      const data = await res.json()
      return data.paired === true
    } catch {
      return false
    }
  }

  /* ── message fold: ported 1:1 from the old plugin's mobile/messages.ts ──
   * EventFolder keeps five index maps alive across folds, applies each event
   * in O(1) map operations, dedupes by maxSeq watermark (replayed events are
   * no-ops), and replaces in place by message id instead of duplicating —
   * the exact incremental discipline of the old mobile surface. The ONLY
   * extension over the old module: user messages also carry `images`
   * (data-URI thumbnails of the phone-attached image parts). */

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function pickString(value) {
    return typeof value === 'string' ? value : undefined
  }

  /** tool/call.arguments is usually a JSON string; some hosts send the object. */
  function pickArgs(value) {
    if (typeof value === 'string' || (value && typeof value === 'object')) return value
    return undefined
  }

  function pickNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

  /** Fallback message id for events without a stable wire id. */
  function syntheticId(prefix, seq) {
    return `${prefix}#${String(seq)}`
  }

  /** Concatenate the plain text of every content block of one type. */
  function blocksOfType(content, type) {
    if (!Array.isArray(content)) return ''
    let out = ''
    for (const block of content) {
      if (!isRecord(block)) continue
      if (block.type !== type) continue
      const text = pickString(block.text)
      if (text !== undefined) out += text
    }
    return out
  }

  function textFromContent(content) {
    return blocksOfType(content, 'text')
  }

  function reasoningFromContent(content) {
    return blocksOfType(content, 'reasoning')
  }

  /** dsh-mobile-plus extension: data-URI thumbnails of inline image parts. */
  function imagesFromContent(content) {
    if (!Array.isArray(content)) return []
    const out = []
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'image') continue
      const mediaType = pickString(block.mediaType) ?? 'image/jpeg'
      const data = pickString(block.data)
      if (data === undefined) continue
      if (data.startsWith('data:')) out.push(data)
      else out.push(`data:${mediaType};base64,${data}`)
    }
    return out
  }

  /**
   * Extract a text-chunk target from `assistant/chunk` or the mobile alias
   * `message/chunk`. DSH shape: data.chunk = { type: 'text-delta' |
   * 'reasoning-delta', text } keyed by (turn, step). Mobile shape: data.text
   * with an optional messageId binding. Returns null for other variants.
   */
  function chunkTarget(data) {
    if (!isRecord(data)) return null
    let text
    let kind = 'text'
    let idValue
    let turn
    let step
    const chunk = data.chunk
    if (isRecord(chunk)) {
      if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return null
      text = pickString(chunk.text)
      kind = chunk.type === 'reasoning-delta' ? 'reasoning' : 'text'
      turn = pickNumber(data.turn)
      step = pickNumber(data.step)
    } else {
      text = pickString(data.text)
      kind = pickString(data.kind) === 'reasoning' ? 'reasoning' : 'text'
      idValue = pickString(data.messageId) ?? pickString(data.id)
      turn = pickNumber(data.turn)
      step = pickNumber(data.step)
    }
    if (text === undefined) return null
    const result = { text, kind }
    if (idValue !== undefined) result.id = idValue
    if (turn !== undefined) result.turn = turn
    if (step !== undefined) result.step = step
    return result
  }

  function tsKey(turn, step) {
    return turn === undefined || step === undefined ? undefined : `${turn}.${step}`
  }

  /**
   * Recover the (turn, step) a pending assistant message was created under from
   * its synthetic id (`assistant,<turn>.<step>#<seq>`), so an incremental fold
   * over an existing list can re-attach index maps lost across calls.
   */
  function decodePendingTurnStep(id) {
    if (!id.startsWith('assistant,')) return undefined
    const rest = id.slice('assistant,'.length)
    const hash = rest.indexOf('#')
    const tsPart = hash === -1 ? rest : rest.slice(0, hash)
    const dot = tsPart.indexOf('.')
    if (dot <= 0 || dot === tsPart.length - 1) return undefined
    const turn = Number(tsPart.slice(0, dot))
    const step = Number(tsPart.slice(dot + 1))
    if (!Number.isInteger(turn) || !Number.isInteger(step)) return undefined
    return { turn, step }
  }

  /** Swap in a replacement message object at the old position and re-index it. */
  function replaceMessage(state, oldMessage, next) {
    const index = state.messages.indexOf(oldMessage)
    if (index !== -1) state.messages[index] = next
    state.byId.delete(oldMessage.id)
    state.byId.set(next.id, next)
  }

  /** Bundle the maps keyed per (turn, step) over to a newly swapped message. */
  function retargetTurnStep(state, key, oldMessage, next) {
    if (key === undefined) return
    if (state.pendingByTurnStep.get(key) === oldMessage) state.pendingByTurnStep.set(key, next)
    if (state.turnStepMessage.get(key) === oldMessage) state.turnStepMessage.set(key, next)
  }

  /** Token usage from an assistant event payload (finite numbers only). */
  function usageFromData(data) {
    const usageData = data.usage
    if (!isRecord(usageData)) return undefined
    const inputTokens = pickNumber(usageData.inputTokens)
    const outputTokens = pickNumber(usageData.outputTokens)
    if (inputTokens === undefined || outputTokens === undefined) return undefined
    const usage = { inputTokens, outputTokens }
    const cacheReadTokens = pickNumber(usageData.cacheReadTokens)
    const cacheWriteTokens = pickNumber(usageData.cacheWriteTokens)
    if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens
    if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens
    return usage
  }

  function applyUserMessage(state, event) {
    const data = isRecord(event.data) ? event.data : {}
    const id = pickString(data.id) ?? syntheticId('user', event.seq)
    const text = textFromContent(data.content)
    const source = isRecord(data.source) ? data.source : {}
    const sourceKind = pickString(source.kind)
    const images = imagesFromContent(data.content)
    const existing = state.byId.get(id)
    if (existing !== undefined) {
      // Idempotent replace (replayed events update in place, never duplicate).
      replaceMessage(state, existing, {
        ...existing,
        ...(sourceKind !== undefined ? { sourceKind } : {}),
        ...(images.length > 0 ? { images } : { images: undefined }),
        text,
        seq: event.seq,
        time: event.time,
      })
      return
    }
    const message = {
      id,
      kind: 'user',
      text,
      ...(sourceKind !== undefined ? { sourceKind } : {}),
      ...(images.length > 0 ? { images } : {}),
      seq: event.seq,
      time: event.time,
    }
    state.messages.push(message)
    state.byId.set(id, message)
  }

  function applyAssistantMessage(state, event) {
    const data = isRecord(event.data) ? event.data : {}
    const messageData = isRecord(data.message) ? data.message : data
    const id = pickString(messageData.id) ?? pickString(data.id) ?? syntheticId('assistant', event.seq)
    const turn = pickNumber(data.turn)
    const step = pickNumber(data.step)
    const finalText = textFromContent(messageData.content)
    const finalReasoning = reasoningFromContent(messageData.content)
    const key = tsKey(turn, step)
    const usage = usageFromData(data)
    const contextWindow = state.contextWindow

    // Finalize the matching assistant message (by id, or by turn/step for the
    // streaming partial that chunks built before the final event arrived).
    let target = state.byId.get(id)
    if (target === undefined && key !== undefined) target = state.pendingByTurnStep.get(key)

    if (target !== undefined) {
      const next = {
        ...target,
        id,
        text: finalText,
        // The final content block list is authoritative; an adapter that omits
        // reasoning from the final message keeps the streamed reasoning text.
        ...(finalReasoning !== '' ? { reasoning: finalReasoning } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(usage !== undefined && contextWindow !== undefined ? { contextWindow } : {}),
        seq: event.seq,
        time: event.time,
        pending: false,
      }
      replaceMessage(state, target, next)
      retargetTurnStep(state, key, target, next)
      if (turn !== undefined) state.messageTurn.set(next.id, turn)
      return
    }

    const message = {
      id,
      kind: 'assistant',
      text: finalText,
      ...(finalReasoning !== '' ? { reasoning: finalReasoning } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(usage !== undefined && contextWindow !== undefined ? { contextWindow } : {}),
      seq: event.seq,
      time: event.time,
    }
    state.messages.push(message)
    state.byId.set(id, message)
    if (key !== undefined) {
      state.pendingByTurnStep.delete(key)
      state.turnStepMessage.set(key, message)
    }
    if (turn !== undefined) state.messageTurn.set(id, turn)
  }

  function applyChunk(state, event) {
    const target = chunkTarget(event.data)
    if (target === null) return
    const key = tsKey(target.turn, target.step)
    let message
    if (target.id !== undefined) {
      message = state.byId.get(target.id)
    } else if (key !== undefined) {
      message = state.pendingByTurnStep.get(key) ?? state.turnStepMessage.get(key)
    }

    if (message !== undefined && message.kind === 'assistant') {
      const next = target.kind === 'reasoning'
        ? { ...message, reasoning: (message.reasoning ?? '') + target.text, seq: event.seq, time: event.time }
        : { ...message, text: message.text + target.text, seq: event.seq, time: event.time }
      replaceMessage(state, message, next)
      retargetTurnStep(state, key, message, next)
      return
    }

    const id = target.id
      ?? (key !== undefined ? syntheticId(`assistant,${key}`, event.seq) : syntheticId('assistant', event.seq))
    const created = target.kind === 'reasoning'
      ? { id, kind: 'assistant', text: '', reasoning: target.text, seq: event.seq, time: event.time, pending: true }
      : { id, kind: 'assistant', text: target.text, seq: event.seq, time: event.time, pending: true }
    state.messages.push(created)
    state.byId.set(id, created)
    if (key !== undefined) {
      state.pendingByTurnStep.set(key, created)
      state.turnStepMessage.set(key, created)
    }
    if (target.turn !== undefined) state.messageTurn.set(id, target.turn)
  }

  function findByIdOrSeq(state, event) {
    const data = isRecord(event.data) ? event.data : {}
    const id = pickString(data.id)
    if (id !== undefined) {
      const byId = state.byId.get(id)
      if (byId !== undefined) return byId
    }
    const seq = pickNumber(data.seq ?? data.messageSeq)
    if (seq !== undefined) {
      return state.messages.find((message) => message.seq === seq)
    }
    return undefined
  }

  function applyUpdate(state, event) {
    const message = findByIdOrSeq(state, event)
    if (message === undefined) return
    const data = isRecord(event.data) ? event.data : {}
    const text = pickString(data.text)
    const next = {
      ...message,
      ...(text !== undefined ? { text } : {}),
      seq: event.seq,
      time: event.time,
    }
    replaceMessage(state, message, next)
  }

  function removeMessage(state, message) {
    const index = state.messages.indexOf(message)
    if (index !== -1) state.messages.splice(index, 1)
    state.byId.delete(message.id)
    state.messageTurn.delete(message.id)
    state.toolNames.delete(message.id)
    for (const [key, candidate] of state.turnStepMessage) {
      if (candidate === message) state.turnStepMessage.delete(key)
    }
    for (const [key, candidate] of state.pendingByTurnStep) {
      if (candidate === message) state.pendingByTurnStep.delete(key)
    }
  }

  function applyDelete(state, event) {
    const message = findByIdOrSeq(state, event)
    if (message === undefined) return
    removeMessage(state, message)
  }

  function applyToolCall(state, event) {
    const data = isRecord(event.data) ? event.data : {}
    const name = pickString(data.name)
    if (name === undefined) return
    const turn = pickNumber(data.turn)
    const step = pickNumber(data.step)
    const key = tsKey(turn, step)

    let target = key === undefined ? undefined : state.turnStepMessage.get(key)
    if (target === undefined && turn !== undefined) {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const candidate = state.messages[i]
        if (candidate !== undefined && candidate.kind === 'assistant' && state.messageTurn.get(candidate.id) === turn) {
          target = candidate
          break
        }
      }
    }
    if (target === undefined) {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const candidate = state.messages[i]
        if (candidate !== undefined && candidate.kind === 'assistant') {
          target = candidate
          break
        }
      }
    }
    if (target === undefined) return

    const names = state.toolNames.get(target.id) ?? new Set()
    const isNewName = !names.has(name)
    if (isNewName) {
      names.add(name)
      state.toolNames.set(target.id, names)
    }
    const callId = pickString(data.callId) ?? `${name}#${String(event.seq)}`
    const args = pickArgs(data.arguments)
    const tools = target.tools ?? []
    const existingIndex = tools.findIndex((tool) => tool.callId === callId)
    const isNewCall = existingIndex === -1
    const nextTools = isNewCall
      ? [...tools, { callId, name, ...(args !== undefined ? { arguments: args } : {}) }]
      : tools.map((tool, index) => index === existingIndex
        ? { ...tool, ...(args !== undefined ? { arguments: args } : {}) }
        : tool)
    const next = {
      ...target,
      ...(isNewName ? { toolSummary: `使用 ${[...names].join(' / ')}` } : {}),
      ...(isNewCall || args !== undefined ? { tools: nextTools } : {}),
      seq: event.seq,
      time: event.time,
    }
    replaceMessage(state, target, next)
    retargetTurnStep(state, key, target, next)
  }

  function applyTurnEnd(state, event) {
    const data = isRecord(event.data) ? event.data : {}
    const turn = pickNumber(data.turn)
    const reason = isRecord(data.reason) ? data.reason : {}
    const failed = reason.kind === 'error'

    let targets
    if (turn !== undefined) {
      targets = state.messages.filter((message) => message.kind === 'assistant' && state.messageTurn.get(message.id) === turn)
    } else {
      targets = state.messages.filter((message) => message.kind === 'assistant')
    }
    if (targets.length === 0) {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const candidate = state.messages[i]
        if (candidate !== undefined && candidate.kind === 'assistant') {
          targets = [candidate]
          break
        }
      }
    }
    for (const message of targets) {
      const wasPending = message.pending === true
      replaceMessage(state, message, {
        ...message,
        ...(wasPending ? { pending: false } : {}),
        ...(failed ? { failed: true } : {}),
        // Preserve each step's own final-event seq; same-turn ordering
        // must not depend on arbitrary ids.
        time: event.time,
      })
    }
  }

  /** Mutable fold state; message objects are immutable and swapped on change. */
  function createState(existing) {
    const messages = existing === undefined ? [] : [...existing]
    const state = {
      messages,
      byId: new Map(),
      pendingByTurnStep: new Map(),
      turnStepMessage: new Map(),
      messageTurn: new Map(),
      toolNames: new Map(),
      contextWindow: undefined,
      maxSeq: -1,
    }
    for (const message of messages) {
      if (message.seq > state.maxSeq) state.maxSeq = message.seq
      state.byId.set(message.id, message)
      if (message.kind !== 'assistant') continue
      // Rebuild the (turn, step) and turn index maps lost when existing was
      // handed back to us as plain rows.
      const decoded = decodePendingTurnStep(message.id)
      const key = decoded === undefined ? undefined : tsKey(decoded.turn, decoded.step)
      if (message.pending === true && key !== undefined) {
        state.pendingByTurnStep.set(key, message)
        state.turnStepMessage.set(key, message)
      }
      if (decoded !== undefined) {
        state.messageTurn.set(message.id, decoded.turn)
      }
    }
    return state
  }

  /** Fold one event into the working state (assumes it passes the watermark). */
  function applyEvent(state, ev) {
    if (ev.seq > state.maxSeq) state.maxSeq = ev.seq
    switch (ev.type) {
      case 'user/message':
        applyUserMessage(state, ev)
        break
      case 'assistant/message':
        applyAssistantMessage(state, ev)
        break
      case 'assistant/chunk':
      case 'message/chunk':
        applyChunk(state, ev)
        break
      case 'message/update':
        applyUpdate(state, ev)
        break
      case 'message/delete':
        applyDelete(state, ev)
        break
      case 'turn/end':
        applyTurnEnd(state, ev)
        break
      case 'tool/call':
        applyToolCall(state, ev)
        break
      case 'todo/write':
        break
      case 'request/context': {
        // Wire shape: { provider, model, contextWindow? }. A present finite
        // contextWindow seeds every later assistant message that reports usage.
        const data = isRecord(ev.data) ? ev.data : {}
        const window = pickNumber(data.contextWindow)
        if (window !== undefined) state.contextWindow = window
        break
      }
      // turn/start, session/end-seed, and every other/unknown type render nothing.
      default:
        break
    }
  }

  /** Copy the folder's rows and keep them seq-ordered (skips re-sorting the common ordered case). */
  function snapshotOf(state) {
    const out = [...state.messages]
    let ordered = true
    for (let index = 1; index < out.length; index += 1) {
      const prev = out[index - 1]
      const current = out[index]
      if (prev.seq > current.seq) {
        ordered = false
        break
      }
    }
    // Array.sort is stable: equal-seq rows keep their event insertion order.
    return ordered ? out : out.sort((a, b) => a.seq - b.seq)
  }

  /**
   * Incremental folder for one message stream. Keeps the index maps alive
   * across folds (O(1) per event), returns the previous snapshot identity
   * unchanged when nothing applied, and treats replayed events as no-ops via
   * the maxSeq watermark — the old plugin's exact discipline.
   */
  class EventFolder {
    constructor(initial) {
      this.state = createState(initial)
      this.snapshotList = undefined
    }

    /** Fold one batch incrementally; returns the current snapshot list. */
    fold(events) {
      const sorted = [...events].sort((a, b) => a.seq - b.seq)
      let applied = false
      for (const ev of sorted) {
        if (ev.seq <= this.state.maxSeq) continue
        applyEvent(this.state, ev)
        applied = true
      }
      if (!applied && this.snapshotList !== undefined) return this.snapshotList
      this.snapshotList = snapshotOf(this.state)
      return this.snapshotList
    }

    /** Replace the whole stream (history reload / session switch). */
    seed(messages) {
      this.state = createState(messages)
      this.snapshotList = undefined
    }

    /** Prepend an older history page (exact seam; no overlapping seqs). */
    prepend(older) {
      this.state = createState([...older, ...this.state.messages])
      this.snapshotList = undefined
    }

    /** Current snapshot list; a fresh copy whenever the folder changed. */
    snapshot() {
      if (this.snapshotList !== undefined) return this.snapshotList
      this.snapshotList = snapshotOf(this.state)
      return this.snapshotList
    }

    /** Highest applied seq; used to poll only events newer than the live fold. */
    maxSeq() {
      return this.state.maxSeq
    }
  }

  /** Fold a batch of session events into a renderable message list. */
  function foldEvents(events, existing) {
    return new EventFolder(existing).fold(events)
  }

  /** Normalize one history entry (the wire wraps events as { event }). */
  function toWireEvent(entry) {
    return entry?.event || entry
  }

  /**
   * Live-event client: ported 1:1 from the old plugin's mobile/mux.ts —
   * EventSource owns reconnection, this class manages the subscription
   * lifecycle PLUS a polling fallback: once the SSE channel has silently
   * stalled (no frame for the stall window, or an EventSource error), it
   * polls the open session's history over plain HTTP and re-emits freshly
   * appended events as `session/event` frames (deduped by per-session seq
   * watermark), so listeners behave exactly as if the frames had arrived
   * over SSE. Empty polls back off to 60s; productive polls reset.
   */
  class MuxClient {
    constructor(url, options = {}) {
      this.url = url ?? '/mp/api/events.mux'
      this.sourceFactory = options.sourceFactory ?? ((u) => new EventSource(u))
      this.pollLatest = options.pollLatest
      this.pollIntervalMs = options.pollIntervalMs ?? 3000
      this.pollDelayMs = this.pollIntervalMs
      this.stallThresholdMs = options.stallThresholdMs ?? 12000
      this.now = options.now ?? (() => Date.now())
      this.listeners = new Set()
      this.source = undefined
      this.stopped = false
      this.observeSessionId = undefined
      this.lastDataAt = 0
      this.sseAlive = false
      this.pollWatermark = new Map()
      this.tickTimer = undefined
      this.polling = false
      this.nextPollAt = 0
    }

    /** Open the stream (idempotent; EventSource reconnects until stop()). */
    start() {
      this.stopped = false
      this.lastDataAt = this.now()
      if (this.source === undefined) this.connect()
      this.startTick()
    }

    /** iOS kills EventSource in the background; reconnect and poll on foreground. */
    wake() {
      if (this.stopped) return
      this.closeSource()
      this.sseAlive = false
      this.lastDataAt = 0
      this.connect()
      if (this.observeSessionId !== undefined) this.startPolling()
    }

    /** Close for good. */
    stop() {
      this.stopped = true
      this.stopTick()
      this.stopPolling()
      this.closeSource()
      this.observeSessionId = undefined
      this.nextPollAt = 0
    }

    /** Subscribe to frames; returns an unsubscribe function. */
    onFrame(listener) {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    }

    /**
     * Point the fallback at one open session (or undefined to stop it).
     * While the SSE channel is stalled this client polls that session's
     * history and re-emits new events as `session/event` frames.
     */
    observe(sessionId) {
      this.observeSessionId = sessionId
      if (sessionId === undefined) {
        this.stopPolling()
        return
      }
      // If SSE is already stalled for this session, start patching right away.
      if (!this.polling && !this.stopped && this.isSseStalled()) this.startPolling()
    }

    connect() {
      // A fresh stream starts unknown; only a delivered frame proves it works.
      this.sseAlive = false
      const source = this.sourceFactory(this.url)
      this.source = source
      source.onmessage = (event) => { this.handleMessage(event.data) }
      source.onerror = () => {
        // EventSource reconnects by itself; when closing, detach first so the
        // native reconnect cannot outlive stop(). Otherwise an error is a
        // strong signal the transport is not delivering — degrade to polling.
        if (this.stopped && this.source === source) {
          this.closeSource()
          return
        }
        this.sseAlive = false
        if (this.observeSessionId !== undefined) this.startPolling()
      }
    }

    /** Single scheduler tick: both the stall check and the poll cadence. */
    startTick() {
      if (this.tickTimer !== undefined) return
      const cadence = Math.min(this.pollIntervalMs, 1000)
      this.tickTimer = setInterval(() => { this.tick() }, cadence)
    }

    stopTick() {
      if (this.tickTimer !== undefined) {
        clearInterval(this.tickTimer)
        this.tickTimer = undefined
      }
    }

    tick() {
      if (this.stopped) return
      if (this.observeSessionId === undefined) return
      if (this.polling) {
        if (this.now() >= this.nextPollAt) {
          this.nextPollAt = Number.POSITIVE_INFINITY
          void this.pollTick()
        }
        return
      }
      if (this.isSseStalled()) this.startPolling()
    }

    isSseStalled() {
      const windowMs = this.sseAlive
        ? this.stallThresholdMs * 3
        : this.stallThresholdMs
      return (this.now() - this.lastDataAt) > windowMs
    }

    startPolling() {
      if (this.polling || this.stopped) return
      this.polling = true
      this.pollDelayMs = this.pollIntervalMs
      this.nextPollAt = Number.POSITIVE_INFINITY
      void this.pollTick()
    }

    stopPolling() {
      this.polling = false
      this.pollDelayMs = this.pollIntervalMs
      this.nextPollAt = 0
    }

    /**
     * Force a history poll now. After session.prompt, a lagged SSE (phone
     * relay / proxy buffering) would otherwise wait for the 12s stall window
     * before the echoed user message appears. Seq watermarks keep this
     * idempotent if SSE later delivers the same events.
     */
    nudge(sessionId, minSeq) {
      if (this.stopped) return
      if (sessionId !== undefined && this.observeSessionId !== sessionId) return
      if (this.observeSessionId === undefined) return
      if (typeof minSeq === 'number') {
        const prev = this.pollWatermark.get(this.observeSessionId) ?? -1
        if (minSeq > prev) this.pollWatermark.set(this.observeSessionId, minSeq)
      }
      this.pollDelayMs = this.pollIntervalMs
      this.polling = true
      this.nextPollAt = Number.POSITIVE_INFINITY
      void this.pollTick()
    }

    /**
     * Fetch the latest history page for the observed session and re-emit any
     * event above the per-session watermark as a `session/event` frame.
     * Idempotent by seq: listeners (and the fold) never see a duplicate.
     */
    async pollTick() {
      const sessionId = this.observeSessionId
      if (sessionId === undefined) {
        this.stopPolling()
        return
      }
      let emitted = 0
      try {
        const page = await this.pollLatest(sessionId)
        let maxSeq = this.pollWatermark.get(sessionId) ?? -1
        const ordered = [...page.events].sort((left, right) => {
          const leftSeq = typeof toWireEvent(left)?.seq === 'number' ? toWireEvent(left).seq : -1
          const rightSeq = typeof toWireEvent(right)?.seq === 'number' ? toWireEvent(right).seq : -1
          return leftSeq - rightSeq
        })
        for (const entry of ordered) {
          const ev = toWireEvent(entry)
          const seq = typeof ev?.seq === 'number' ? ev.seq : -1
          if (seq <= maxSeq) continue
          maxSeq = seq
          emitted += 1
          this.emit({ type: 'session/event', sessionId, event: ev })
        }
        this.pollWatermark.set(sessionId, maxSeq)
        // History tail carries the title projection even when the session/title
        // event itself has scrolled out of the page window.
        const projectedTitle = page.projections?.values?.title
        if (typeof projectedTitle === 'string' && projectedTitle.trim()) {
          this.emit({
            type: 'session/projection',
            sessionId,
            key: 'title',
            value: projectedTitle,
            seq: typeof page.projections.asOfSeq === 'number' ? page.projections.asOfSeq : maxSeq,
          })
        }
        // Todos ride turn/start + todo/write events (standing-plan lifetime).
        // Do not re-emit the history-tail projection here: its asOfSeq is the
        // log head, which would stamp an unchanged list with a high seq and
        // clobber a newer live todo_write / optimistic tool/call.
      } catch {
        // Transient (network, pairing, history paging); retry with backoff.
      } finally {
        if (emitted > 0) {
          this.pollDelayMs = this.pollIntervalMs
        } else {
          this.pollDelayMs = Math.min(60000, this.pollDelayMs + this.pollIntervalMs)
        }
        if (this.polling && this.observeSessionId === sessionId) {
          this.nextPollAt = this.now() + this.pollDelayMs
        }
      }
    }

    /**
     * Our /mp/api/events.mux pushes raw mux frames; older hosts push
     * server-request envelopes whose payload is the frame. Accept both and
     * drop unknown frame shapes so a newer host never breaks this client.
     */
    handleMessage(data) {
      const frame = parseLiveFrame(data)
      if (!frame) return
      // A delivered frame proves the SSE channel is live (the tunnel forwards
      // it) and delivers again — drop any fallback polling so the live stream
      // takes over without double delivery.
      this.sseAlive = true
      this.lastDataAt = this.now()
      if (this.polling) this.stopPolling()
      this.emit(frame)
    }

    emit(frame) {
      for (const listener of this.listeners) {
        try {
          listener(frame)
        } catch {
          // A throwing subscriber must not break the emit loop.
        }
      }
    }

    closeSource() {
      const source = this.source
      this.source = undefined
      if (source !== undefined) {
        source.onmessage = null
        source.onerror = null
        try {
          source.close()
        } catch {
          // Already closed.
        }
      }
    }
  }

  /**
   * Accept raw mux/host SSE payloads and older server-request envelopes.
   * Shared by MuxClient and HostClient so a newer host never breaks either.
   */
  function parseLiveFrame(data) {
    if (typeof data !== 'string' || data === '') return null
    let parsed
    try {
      parsed = JSON.parse(data)
    } catch {
      return null
    }
    if (!isRecord(parsed)) return null
    let frame = parsed
    if (parsed.type === 'server-request' && isRecord(parsed.payload)) {
      frame = parsed.payload
      if (typeof parsed.rpcId === 'string' && frame.rpcId === undefined) frame = { ...frame, rpcId: parsed.rpcId }
    }
    if (!isRecord(frame) || typeof frame.type !== 'string') return null
    return frame
  }

  /**
   * Web sidebar running-dots come from `/api/events.host` (`host/session-status`),
   * not from mux turn/start|end. Phone must subscribe to the same stream.
   */
  class HostClient {
    constructor(url, options = {}) {
      this.url = url ?? '/mp/api/events.host'
      this.sourceFactory = options.sourceFactory ?? ((u) => new EventSource(u))
      this.listeners = new Set()
      this.source = undefined
      this.stopped = false
    }

    start() {
      this.stopped = false
      if (this.source === undefined) this.connect()
    }

    stop() {
      this.stopped = true
      this.closeSource()
    }

    onFrame(listener) {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    }

    wake() {
      if (this.stopped) return
      this.closeSource()
      this.connect()
    }

    connect() {
      const source = this.sourceFactory(this.url)
      this.source = source
      source.onmessage = (event) => {
        const frame = parseLiveFrame(event.data)
        if (!frame) return
        this.emit(frame)
      }
      source.onerror = () => {
        if (this.stopped && this.source === source) this.closeSource()
      }
    }

    emit(frame) {
      for (const listener of this.listeners) {
        try {
          listener(frame)
        } catch {
          // A throwing subscriber must not break the emit loop.
        }
      }
    }

    closeSource() {
      const source = this.source
      this.source = undefined
      if (source !== undefined) {
        source.onmessage = null
        source.onerror = null
        try {
          source.close()
        } catch {
          // Already closed.
        }
      }
    }
  }

  function sessionTitle(item) {
    const fromProj = item.projections?.values?.title
    if (typeof fromProj === 'string' && fromProj.trim()) return fromProj.trim()
    if (item.title && !String(item.title).startsWith('session-') && item.title !== item.sessionId) return item.title
    // Blank new chats have a cwd (the workspace path). Don't show that folder
    // name in the header / list — wait for the host title projection.
    if (item.blank) return '新会话'
    if (item.cwd) return basename(item.cwd)
    return '新会话'
  }

  /** Per-session seq watermark for title projections (higher-seq-wins). */
  const titleWatermark = new Map()

  function titleText(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  function withSessionTitle(item, title) {
    if (item.projections?.values?.title === title && item.title === title) return item
    const values = { ...(item.projections?.values || {}), title }
    const projections = item.projections && typeof item.projections === 'object'
      ? { ...item.projections, values }
      : { values }
    return { ...item, title, projections }
  }

  /**
   * Apply a host-generated (or user-renamed) session title onto the open chat
   * and the in-memory list row. Empty values are ignored so a stale history
   * snapshot cannot wipe a live title that arrived during loadTail.
   */
  function applySessionTitle(sessionId, value, seq) {
    const title = titleText(value)
    if (!title) return false
    if (typeof seq === 'number') {
      const prev = titleWatermark.get(sessionId)
      if (prev !== undefined && seq <= prev) return false
      titleWatermark.set(sessionId, seq)
    }
    let changed = false
    if (state.session?.sessionId === sessionId) {
      const next = withSessionTitle(state.session, title)
      if (next !== state.session) {
        state.session = next
        changed = true
      }
    }
    const index = state.sessions.findIndex((row) => row.sessionId === sessionId)
    if (index >= 0) {
      const next = withSessionTitle(state.sessions[index], title)
      if (next !== state.sessions[index]) {
        const sessions = state.sessions.slice()
        sessions[index] = next
        state.sessions = sessions
        changed = true
      }
    }
    return changed
  }

  function seedSessionTitleFromPage(sessionId, page) {
    const projected = titleText(page?.projections?.values?.title)
    if (projected) {
      const seq = typeof page.projections?.asOfSeq === 'number' ? page.projections.asOfSeq : undefined
      return applySessionTitle(sessionId, projected, seq)
    }
    const events = page?.events || []
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = toWireEvent(events[i])
      if (ev?.type !== 'session/title') continue
      const data = isRecord(ev.data) ? ev.data : {}
      const seq = typeof ev.seq === 'number' ? ev.seq : undefined
      if (applySessionTitle(sessionId, data.title, seq)) return true
    }
    return false
  }

  /* ── data loading ──────────────────────────────────────────────────── */

  async function loadWorkspaces() {
    const data = await call('workspace.list', {})
    state.workspaces = data.items || []
  }

  async function loadPresets() {
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

  let sessionsQuery = 0
  const SESSION_PAGE = 20

  function ownedSessionIds(workspace) {
    return new Set((workspace && workspace.sessionIds) || [])
  }

  function applySessionPage(items, owned, listedAt = 0) {
    const rows = (items || []).filter((s) => owned.has(s.sessionId))
    for (const s of rows) hydrateSessionLive(s, listedAt)
    return rows
  }

  /**
   * Pull workspace-owned rows until we have a page, or the host is exhausted.
   * Covers two hosts: workspace-scoped pagination (one call) and the old
   * global 20-at-a-time list (keep walking past empty owned pages).
   */
  async function collectOwnedPages(workspaceId, owned, startCursor, already, listedAt = Date.now()) {
    if (owned.size === 0) return { items: already.slice(), nextCursor: undefined, hasMore: false }
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
      const extra = applySessionPage(page.items, owned, listedAt)
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

  async function openWorkspace(ws, opts = {}) {
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

  async function loadSessions() {
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

  function sessionStatusKey(items) {
    return (items || []).map((s) => {
      const row = sessionLive.get(s.sessionId)
      return `${s.sessionId}:${row?.running ? 1 : 0}:${s.updatedAt || 0}:${s.title || ''}`
    }).join('|')
  }

  function mergeSessionsFromSnapshot(items) {
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

  /**
   * Reconcile session running bits against session.list. Host SSE is the
   * fast path; this is the phone-relay / background-kill fallback so a
   * finished PC turn cannot stay spinning on the list forever.
   */
  async function refreshLiveSnapshot() {
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
          state.running = next
          changed = true
        }
      }
      if (changed && (state.view === 'sessions' || state.view === 'chat')) render()
      return changed
    } catch {
      return false
    }
  }

  const LIST_POLL_MS = 4000

  function startListPoll() {
    if (listPollTimer !== null) return
    listPollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refreshLiveSnapshot()
    }, LIST_POLL_MS)
  }

  function stopListPoll() {
    if (listPollTimer !== null) {
      clearInterval(listPollTimer)
      listPollTimer = null
    }
  }

  async function loadMoreSessions() {
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

  async function createSession() {
    if (state.creating) return
    state.creating = true
    state.createError = ''
    render()
    try {
      const created = await call('session.create', {
        workspaceId: state.workspace.workspaceId,
        ...(state.presetId ? { agentPreset: state.presetId } : {}),
      })
      if (state.workspace && created && created.sessionId) {
        const ids = Array.isArray(state.workspace.sessionIds) ? state.workspace.sessionIds : []
        if (!ids.includes(created.sessionId)) {
          state.workspace.sessionIds = [created.sessionId].concat(ids)
        }
      }
      state.creating = false
      await openChat({ sessionId: created.sessionId, title: '新会话' })
    } catch (err) {
      state.creating = false
      state.createError = String(err.message || err)
      render()
    }
  }

  /* ── chat: tail load + incremental live fold (old-plugin discipline) ── */

  /**
   * Tail page on open. Live events arriving in this window go to
   * chat.liveBuffer instead of the fold: the tail load replaces the list
   * wholesale, so a directly folded event would flash once, be discarded by
   * the snapshot, and then be skipped forever by the seq watermark.
   */
  async function loadTail() {
    const sid = state.session && state.session.sessionId
    if (!sid) return
    chat.loading = true
    chat.tailLoading = true
    chat.liveBuffer = []
    chat.overflow = false
    chat.folder = null
    chat.messages = []
    render()
    try {
      const page = await call('session.history', { sessionId: sid, maxMessages: 30 })
      if (state.session?.sessionId !== sid) return
      // Buffered live events re-fold on top of the snapshot; the watermark
      // drops any the snapshot already includes, so nothing is lost or doubled.
      const buffered = chat.liveBuffer
      chat.liveBuffer = []
      chat.tailLoading = false
      const folder = new EventFolder(foldEvents((page.events || []).map(toWireEvent)))
      chat.folder = folder
      chat.messages = folder.fold(buffered)
      chat.hasOlder = Boolean(page.hasMore)
      seedTodosFromPage(sid, page, buffered)
      seedSessionTitleFromPage(sid, page)
      reconcileOutbox(sid)
      state.error = ''
      // The buffer overflowed while waiting (oldest events were dropped), so
      // re-pull the freshest history page to close the gap on top of what is
      // already rendered. Best-effort: a failure here only ignores, it must
      // not replace the loaded state with an error.
      if (chat.overflow) {
        chat.overflow = false
        try {
          const fresh = await call('session.history', { sessionId: sid, maxMessages: 30 })
          if (state.session?.sessionId !== sid) return
          chat.messages = folder.fold((fresh.events || []).map(toWireEvent))
          seedTodosFromPage(sid, fresh)
          seedSessionTitleFromPage(sid, fresh)
          reconcileOutbox(sid)
        } catch { /* best-effort */ }
      }
    } catch (err) {
      if (state.session?.sessionId !== sid) return
      // Load failed: flush the buffer so the live stream still renders.
      const buffered = chat.liveBuffer
      chat.liveBuffer = []
      chat.tailLoading = false
      if (chat.folder === null) chat.folder = new EventFolder()
      if (buffered.length > 0) chat.messages = chat.folder.fold(buffered)
      chat.todos = applyTodoEventsAfter([], buffered)
      reconcileOutbox(sid)
      state.error = String(err.message || err)
    } finally {
      if (state.session?.sessionId !== sid) return
      chat.loading = false
      render()
    }
  }

  /** Prepend an older history page (exact seam — no overlapping seqs). */
  async function loadOlder() {
    const oldest = chat.messages[0]
    if (!oldest) return
    try {
      const page = await call('session.history', {
        sessionId: state.session.sessionId,
        maxMessages: 30,
        beforeSeq: Math.max(1, oldest.seq - 1),
      })
      const existing = document.querySelector('.chat-scroll')
      prependAdjust = existing
        ? { height: existing.scrollHeight, top: existing.scrollTop }
        : null
      chatScroll.stick = false
      const olderMsgs = foldEvents((page.events || []).map(toWireEvent))
      chat.folder.prepend(olderMsgs)
      chat.messages = chat.folder.snapshot()
      chat.hasOlder = Boolean(page.hasMore)
      render()
    } catch (err) {
      prependAdjust = null
      state.error = String(err.message || err)
      render()
    }
  }

  async function openChat(session, opts = {}) {
    const q = ++chatQuery
    state.session = session
    state.view = 'chat'
    state.draft = ''
    state.images = []
    state.sending = false
    lastMsgScrollKey = null
    chatScroll.stick = true
    chatScroll.top = 0
    chatScroll.restoring = false
    todoScroll.top = 0
    todoScroll.stick = true
    todoWatermark.delete(session.sessionId)
    chat.todos = null
    chat.approvals = []
    chat.questions = []
    const live = ensureLive(session.sessionId)
    live.completed = false
    state.running = live.running === true || session.running === true
    const mode = opts.locationMode || 'push'
    if (state.workspace && state.workspace.workspaceId) {
      const loc = { view: 'chat', workspaceId: state.workspace.workspaceId, sessionId: session.sessionId }
      if (mode !== 'none') commitLocation(loc, mode)
      else persistRoute(loc)
    }
    render()
    if (q !== chatQuery) return
    await ensureMux()
    if (q !== chatQuery) return
    mux.observe(session.sessionId)
    // Best-effort current model for the settings row (the sheet re-reads the
    // directory on every open) — old-plugin parity.
    void call('session.models', { sessionId: session.sessionId }).then((data) => {
      if (q !== chatQuery) return
      chat.currentModel = data.current
      if (state.view === 'chat') render()
    }).catch(() => { /* settings row falls back to a plain label */ })
    void loadSlashCatalog(session.sessionId)
    startPendingPoll()
    // loadTail 内部完成时会 render（贴底 rAF 指向它构建的 scroller）；
    // 这里不能再 render 一次——那会让上一个 rAF 失效并恢复 prevTop=0（Bug #1042）
    await loadTail()
  }

  function showWorkspaces(locationMode = 'push') {
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

  function showSessionsFromChat(ws, locationMode) {
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

  function enterDir(locationMode = 'push') {
    state.dir = null
    state.dirError = ''
    state.view = 'dir'
    if (locationMode !== 'none') commitLocation({ view: 'dir' }, locationMode)
    else persistRoute({ view: 'dir' })
    render()
    void openDir()
  }

  async function applyRoute(route, opts = {}) {
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

  async function restoreRoute() {
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

  /* ── live mux (ported from the old plugin's mobile/mux.ts) ──────────── */

  async function ensureMux() {
    if (mux !== null) return
    mux = new MuxClient('/mp/api/events.mux', {
      pollLatest: (sessionId) => call('session.history', { sessionId, maxMessages: 50 }),
    })
    mux.onFrame(handleMuxFrame)
    mux.start()
  }

  async function ensureHost() {
    if (host !== null) return
    host = new HostClient('/mp/api/events.host')
    host.onFrame(handleMuxFrame)
    host.start()
  }

  function applyPendingFrame(frame) {
    if (!frame || frame.sessionId !== state.session?.sessionId) return false
    if (frame.type === 'approval/requested') {
      if (chat.approvals.some((row) => row.approvalId === frame.approvalId)) return false
      chat.approvals.push({
        rpcId: frame.rpcId,
        approvalId: frame.approvalId,
        toolName: frame.toolName || 'tool',
        callId: frame.callId,
        reason: frame.reason,
      })
      return true
    }
    if (frame.type === 'approval/resolved') {
      const before = chat.approvals.length
      chat.approvals = chat.approvals.filter((row) => row.approvalId !== frame.approvalId)
      return chat.approvals.length !== before
    }
    if (frame.type === 'question/requested') {
      const rpcId = frame.rpcId
      if (rpcId && chat.questions.some((row) => row.rpcId === rpcId)) return false
      chat.questions.push({
        rpcId,
        questions: Array.isArray(frame.questions) ? frame.questions : [],
        answers: {},
      })
      return true
    }
    if (frame.type === 'question/resolved') {
      const before = chat.questions.length
      chat.questions = chat.questions.filter((row) => row.rpcId !== frame.questionRpcId)
      return chat.questions.length !== before
    }
    return false
  }

  function mergePendingSnapshot(snapshot) {
    if (!snapshot) return
    const approvals = Array.isArray(snapshot.approvals) ? snapshot.approvals : []
    const questions = Array.isArray(snapshot.questions) ? snapshot.questions : []
    chat.approvals = approvals.map((row) => ({
      rpcId: row.rpcId,
      approvalId: row.approvalId,
      toolName: row.toolName || 'tool',
      callId: row.callId,
      reason: row.reason,
    }))
    const prev = new Map(chat.questions.map((row) => [row.rpcId, row]))
    chat.questions = questions.map((row) => {
      const existing = prev.get(row.rpcId)
      return {
        rpcId: row.rpcId,
        questions: Array.isArray(row.questions) ? row.questions : [],
        answers: existing ? existing.answers : {},
        error: existing ? existing.error : undefined,
        busy: existing ? existing.busy : false,
      }
    })
  }

  async function refreshPending() {
    if (!state.session || state.view !== 'chat') return
    try {
      const snapshot = await call('mobile.pending', { sessionId: state.session.sessionId })
      mergePendingSnapshot(snapshot)
      if (state.view === 'chat') render()
    } catch {
      /* polling fallback is best-effort */
    }
  }

  function startPendingPoll() {
    stopPendingPoll()
    void refreshPending()
    pendingPoll = setInterval(() => { void refreshPending() }, 2500)
  }

  function stopPendingPoll() {
    if (pendingPoll !== null) {
      clearInterval(pendingPoll)
      pendingPoll = null
    }
  }

  function contextUsage() {
    for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
      const message = chat.messages[i]
      if (message.kind !== 'assistant' || !message.usage) continue
      const windowSize = message.contextWindow
      if (!windowSize || windowSize <= 0) continue
      const tokens = message.usage.inputTokens + (message.usage.cacheReadTokens || 0) + (message.usage.cacheWriteTokens || 0)
      return Math.round(tokens / windowSize * 100)
    }
    return undefined
  }

  function autosizeInput(node) {
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 120)}px`
  }

  /**
   * Phone software keyboards emit Enter without Shift for the 换行 key.
   * Treating that as send makes it impossible to insert a newline.
   * Desktop (fine pointer + hover) keeps Enter-to-send / Shift+Enter newline.
   */
  function composerReturnIsNewline() {
    const ua = navigator.userAgent || ''
    if (/iPhone|iPod|Android.+Mobile/i.test(ua)) return true
    if (/iPad/i.test(ua)) return true
    if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) return true
    try {
      if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true
    } catch {
      /* ignore */
    }
    return false
  }

  function renderApprovalPanel(approval) {
    return el('div', { class: 'chat-approval-panel', role: 'alert' }, [
      el('div', { class: 'chat-approval-header' }, [
        el('span', { class: 'chat-tool-pill' }, [approval.toolName]),
        approval.reason ? el('span', { class: 'chat-approval-reason' }, [approval.reason]) : null,
      ]),
      approval.error ? el('p', { class: 'chat-approval-error' }, [approval.error]) : null,
      el('div', { class: 'chat-approval-actions' }, [
        el('button', {
          type: 'button',
          class: 'chat-approval-allow',
          disabled: approval.busy === true,
          onclick: () => { void respondApproval(approval, 'allowed-once') },
        }, [approval.busy ? '提交中…' : '允许一次']),
        el('button', {
          type: 'button',
          class: 'chat-approval-reject',
          disabled: approval.busy === true,
          onclick: () => { void respondApproval(approval, 'rejected') },
        }, ['拒绝']),
      ]),
    ])
  }

  async function respondApproval(approval, outcome) {
    if (approval.busy || !state.session) return
    approval.busy = true
    approval.error = undefined
    render()
    try {
      await call('mobile.respond', {
        sessionId: state.session.sessionId,
        type: 'approval',
        approvalId: approval.approvalId,
        rpcId: approval.rpcId,
        outcome,
      })
      chat.approvals = chat.approvals.filter((row) => row.approvalId !== approval.approvalId)
    } catch (err) {
      approval.busy = false
      approval.error = String(err.message || err)
    }
    render()
  }

  function answerOf(group, questionId) {
    if (!group.answers[questionId]) group.answers[questionId] = { selected: [], custom: '' }
    return group.answers[questionId]
  }

  function renderQuestionPanel(group) {
    return el('div', { class: 'chat-question-panel', role: 'form' }, [
      ...group.questions.map((q) => {
        const answer = answerOf(group, q.id)
        const multi = q.multiSelect === true
        return el('div', { class: 'chat-question-group' }, [
          q.header ? el('div', { class: 'chat-question-header' }, [q.header]) : null,
          el('div', { class: 'chat-question-text' }, [q.question]),
          q.detail ? el('div', { class: 'chat-question-detail' }, [q.detail]) : null,
          Array.isArray(q.options) && q.options.length
            ? el('div', { class: 'chat-question-options' }, q.options.map((option) => {
                const label = option.label
                const selected = answer.selected.includes(label)
                return el('label', { class: `chat-question-option${selected ? ' chat-question-option-selected' : ''}` }, [
                  el('input', {
                    type: multi ? 'checkbox' : 'radio',
                    name: `q-${group.rpcId}-${q.id}`,
                    checked: selected,
                    onchange: () => {
                      if (multi) {
                        const set = new Set(answer.selected)
                        if (set.has(label)) set.delete(label)
                        else set.add(label)
                        answer.selected = [...set]
                      } else {
                        answer.selected = [label]
                      }
                      render()
                    },
                  }),
                  el('span', { class: 'chat-question-option-label' }, [label]),
                  option.description ? el('span', { class: 'chat-question-option-desc' }, [option.description]) : null,
                ])
              }))
            : null,
          el('textarea', {
            class: 'chat-question-custom',
            placeholder: '自定义回答（可选）',
            rows: 2,
            value: answer.custom,
            oninput: (ev) => { answer.custom = ev.target.value },
          }),
        ])
      }),
      group.error ? el('p', { class: 'chat-approval-error' }, [group.error]) : null,
      el('button', {
        type: 'button',
        class: 'chat-question-submit',
        disabled: group.busy === true,
        onclick: () => { void respondQuestion(group) },
      }, [group.busy ? '提交中…' : '提交回答']),
    ])
  }

  async function respondQuestion(group) {
    if (group.busy || !state.session) return
    group.busy = true
    group.error = undefined
    render()
    const answers = group.questions.map((q) => {
      const answer = answerOf(group, q.id)
      return {
        id: q.id,
        selected: answer.selected,
        ...(answer.custom ? { custom: answer.custom } : {}),
      }
    })
    try {
      await call('mobile.respond', {
        sessionId: state.session.sessionId,
        type: 'question',
        rpcId: group.rpcId,
        answers,
      })
      chat.questions = chat.questions.filter((row) => row.rpcId !== group.rpcId)
    } catch (err) {
      group.busy = false
      group.error = String(err.message || err)
    }
    render()
  }

  /** Fold live frames: session-list status for every session, chat for the open one. */
  function handleMuxFrame(frame) {
    const pendingChanged = applyPendingFrame(frame)
    if (pendingChanged && state.view === 'chat') render()
    const statusChanged = applySessionLive(frame)
    if (frame?.type === 'host/session-status' && typeof frame.sessionId === 'string') {
      if (frame.sessionId === state.session?.sessionId) {
        const next = frame.running === true
        if (state.running !== next) {
          state.running = next
          if (next === false) void loadQuota(true)
          if (state.view === 'chat') render()
        }
      }
      if (statusChanged && state.view === 'sessions') render()
      return
    }
    if (frame && typeof frame.type === 'string' && frame.type.startsWith('host/')) {
      if (
        frame.type === 'host/session-added'
        || frame.type === 'host/session-removed'
        || frame.type === 'host/workspace-changed'
        || frame.type === 'host/workspace-removed'
        || frame.type === 'host/workspace-order-changed'
      ) {
        void refreshLiveSnapshot()
      }
      return
    }
    if (frame?.type === 'session/projection' && typeof frame.sessionId === 'string') {
      if (frame.key === 'title') {
        if (applySessionTitle(frame.sessionId, frame.value, frame.seq) && (state.view === 'chat' || state.view === 'sessions')) {
          render()
        }
        return
      }
      if (frame.key === 'todos') {
        if (applyTodosProjection(frame.sessionId, frame.value, frame.seq) && state.view === 'chat') {
          render()
        }
        return
      }
    }
    if (frame?.type === 'session/event' && typeof frame.sessionId === 'string' && frame.event?.type === 'session/title') {
      const data = isRecord(frame.event.data) ? frame.event.data : {}
      if (applySessionTitle(frame.sessionId, data.title, frame.event.seq) && (state.view === 'chat' || state.view === 'sessions')) {
        render()
      }
      return
    }
    if (statusChanged && state.view === 'sessions') render()
    if (frame?.type !== 'session/event' || typeof frame.sessionId !== 'string') return
    const ev = frame.event
    if (!ev || typeof ev.type !== 'string') return
    if (frame.sessionId !== state.session?.sessionId) {
      // Keep the local bubble until the open chat can fold the echo; other
      // sessions can drop the matching outbox row immediately.
      if (ev.type === 'user/message' && dropOutboxEcho(frame.sessionId, ev) && state.view === 'chat') render()
      return
    }
    const turnMarker = ev.type === 'turn/start' || ev.type === 'turn/end'
    if (ev.type === 'turn/start') state.running = true
    if (ev.type === 'turn/end') {
      state.running = false
      void loadQuota(true)
    }
    if (chat.tailLoading) {
      if (chat.liveBuffer.length >= 500) {
        chat.liveBuffer.shift()
        chat.overflow = true
      }
      chat.liveBuffer.push(ev)
      return
    }
    if (!chat.folder) return
    const next = chat.folder.fold([ev])
    const todosChanged = applyTodosLiveEvent(frame.sessionId, ev)
    const messagesChanged = next !== chat.messages
    if (messagesChanged) chat.messages = next
    const outboxChanged = ev.type === 'user/message' && reconcileOutbox(frame.sessionId)
    if (messagesChanged || turnMarker || todosChanged || outboxChanged) render()
  }

  function stopMuxObservation() {
    stopPendingPoll()
    if (mux !== null) mux.observe(undefined)
  }

  /* ── composer image handling ───────────────────────────────────────── */

  async function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  /**
   * 压缩一张手机图，输出两版：
   * - full：≤1600px JPEG 0.85 —— 主机用它落盘 .dsh-mobile-inbox/，模型
   *   按路径 read_image 读的就是它（识别精度不变）
   * - thumb（content.data）：≤320px JPEG 0.75 —— 仅进会话内容/历史传输，
   *   聊天记录与历史加载只传这一份（观看体验：流畅优先，精度够看清即可）
   */
  async function compress(file) {
    const dataUrl = await readAsDataURL(file)
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = dataUrl
    })
    const render = (max, quality) => {
      let { width, height } = img
      const scale = Math.min(max / width, max / height, 1)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      const jpeg = canvas.toDataURL('image/jpeg', quality)
      return jpeg.split(',')[1]
    }
    const full = render(1600, 0.85)
    const thumb = render(320, 0.75)
    return {
      mediaType: 'image/jpeg',
      data: thumb,
      fullData: full,
      name: file.name,
      preview: `data:image/jpeg;base64,${thumb}`,
    }
  }

  async function onPickFile(ev) {
    const files = [...(ev.target.files || [])].slice(0, 4)
    const next = []
    for (const file of files) {
      if (file.type.startsWith('image/')) next.push(await compress(file))
    }
    state.images = next
    ev.target.value = ''
    render()
  }

  /* ── image lightbox (pending composer + sent chat thumbs) ─────────────
   * The page viewport is user-scalable=no, so native pinch-zoom cannot
   * enlarge a 56px thumb. This overlay lives on document.body (outside
   * #root) so live chat re-renders do not reset the zoom transform.
   * Pending pics use the 1600px fullData; history only has 320px thumbs. */

  let lightboxNode = null
  let lightboxEsc = null
  let lightboxCleanup = null

  function composerSrc(img) {
    if (img && typeof img.fullData === 'string' && img.fullData !== '') {
      return `data:${img.mediaType || 'image/jpeg'};base64,${img.fullData}`
    }
    return img && img.preview ? img.preview : ''
  }

  function closeImageLightbox() {
    if (lightboxCleanup) {
      lightboxCleanup()
      lightboxCleanup = null
    }
    if (lightboxEsc) {
      document.removeEventListener('keydown', lightboxEsc)
      lightboxEsc = null
    }
    if (lightboxNode) {
      lightboxNode.remove()
      lightboxNode = null
    }
  }

  function openImageLightbox(src) {
    if (!src) return
    closeImageLightbox()

    const img = el('img', { class: 'img-lightbox-img', src, alt: '图片预览' })
    img.draggable = false
    const stage = el('div', { class: 'img-lightbox-stage' }, [img])
    const closeBtn = el('button', {
      type: 'button',
      class: 'img-lightbox-close',
      'aria-label': '关闭预览',
    }, ['×'])
    const hint = el('div', { class: 'img-lightbox-hint' }, ['点一下关闭 · 双击或捏合放大'])
    const node = el('div', {
      class: 'img-lightbox',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '图片预览',
    }, [stage, closeBtn, hint])
    node.dataset.src = src
    closeBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      closeImageLightbox()
    })
    node.addEventListener('touchmove', (ev) => { ev.preventDefault() }, { passive: false })
    attachLightboxZoom(stage, img)
    lightboxEsc = (ev) => { if (ev.key === 'Escape') closeImageLightbox() }
    document.addEventListener('keydown', lightboxEsc)
    lightboxNode = node
    document.body.append(node)
  }

  function attachLightboxZoom(stage, img) {
    let scale = 1
    let x = 0
    let y = 0
    let pan = null
    let pinch0 = null
    let lastTapAt = 0
    let lastTapX = 0
    let lastTapY = 0
    let moved = false
    let closeTimer = 0
    let mouseDown = false
    let ignoreMouseUntil = 0

    const cancelCloseTimer = () => {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = 0
      }
    }

    img.style.transformOrigin = '0 0'
    const apply = () => {
      img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    }

    const zoomAt = (cx, cy, next) => {
      next = Math.min(5, Math.max(1, next))
      if (next === scale) return
      const rect = img.getBoundingClientRect()
      const prev = scale || 1
      x += ((cx - rect.left) / prev) * (prev - next)
      y += ((cy - rect.top) / prev) * (prev - next)
      scale = next
      if (scale === 1) {
        x = 0
        y = 0
      }
    }

    const endGesture = (clientX, clientY, target) => {
      pinch0 = null
      pan = null
      mouseDown = false
      if (scale < 1.02) {
        scale = 1
        x = 0
        y = 0
        apply()
      }
      if (moved) {
        lastTapAt = 0
        return
      }
      const now = Date.now()
      const isDouble = now - lastTapAt < 300 && Math.hypot(clientX - lastTapX, clientY - lastTapY) < 28
      if (isDouble) {
        lastTapAt = 0
        cancelCloseTimer()
        if (scale > 1.05) {
          scale = 1
          x = 0
          y = 0
        } else {
          zoomAt(clientX, clientY, 2.6)
        }
        apply()
        return
      }
      lastTapAt = now
      lastTapX = clientX
      lastTapY = clientY
      if (scale > 1.05) {
        if (target !== img) {
          scale = 1
          x = 0
          y = 0
          apply()
        }
        return
      }
      /* Full-bleed screenshots leave no blank margin; delay so a double-tap
         can still zoom, then close on a single tap anywhere. */
      closeTimer = setTimeout(() => {
        closeTimer = 0
        if (lastTapAt === now) closeImageLightbox()
      }, 320)
    }

    const onTouchStart = (ev) => {
      ignoreMouseUntil = Date.now() + 700
      cancelCloseTimer()
      if (ev.touches.length === 1) {
        moved = false
        pan = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, ox: x, oy: y }
        pinch0 = null
      } else if (ev.touches.length >= 2) {
        const a = ev.touches[0]
        const b = ev.touches[1]
        pinch0 = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale }
        pan = null
        moved = true
      }
    }

    const onTouchMove = (ev) => {
      ev.preventDefault()
      if (ev.touches.length >= 2 && pinch0 && pinch0.dist > 0) {
        const a = ev.touches[0]
        const b = ev.touches[1]
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        zoomAt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, pinch0.scale * (dist / pinch0.dist))
        apply()
        return
      }
      if (ev.touches.length === 1 && pan) {
        const dx = ev.touches[0].clientX - pan.x
        const dy = ev.touches[0].clientY - pan.y
        if (Math.hypot(dx, dy) > 6) moved = true
        if (scale > 1) {
          x = pan.ox + dx
          y = pan.oy + dy
          apply()
        }
      }
    }

    const onTouchEnd = (ev) => {
      ignoreMouseUntil = Date.now() + 700
      if (ev.touches.length >= 2) return
      if (ev.touches.length === 1) {
        const t = ev.touches[0]
        pan = { x: t.clientX, y: t.clientY, ox: x, oy: y }
        pinch0 = null
        return
      }
      const t = ev.changedTouches[0]
      endGesture(t.clientX, t.clientY, ev.target)
    }

    const onTouchCancel = (ev) => {
      ignoreMouseUntil = Date.now() + 700
      moved = true
      const t = ev.changedTouches[0]
      endGesture(t ? t.clientX : 0, t ? t.clientY : 0, ev.target)
    }

    const onMouseDown = (ev) => {
      if (ev.button !== 0 || Date.now() < ignoreMouseUntil) return
      cancelCloseTimer()
      mouseDown = true
      moved = false
      pan = { x: ev.clientX, y: ev.clientY, ox: x, oy: y }
    }

    const onMouseMove = (ev) => {
      if (!mouseDown || !pan) return
      const dx = ev.clientX - pan.x
      const dy = ev.clientY - pan.y
      if (Math.hypot(dx, dy) > 6) moved = true
      if (scale > 1) {
        x = pan.ox + dx
        y = pan.oy + dy
        apply()
      }
    }

    const onMouseUp = (ev) => {
      if (!mouseDown) return
      endGesture(ev.clientX, ev.clientY, ev.target)
    }

    const onWheel = (ev) => {
      ev.preventDefault()
      zoomAt(ev.clientX, ev.clientY, scale * (ev.deltaY > 0 ? 0.88 : 1.14))
      apply()
    }

    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false })
    stage.addEventListener('touchend', onTouchEnd)
    stage.addEventListener('touchcancel', onTouchCancel)
    stage.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    stage.addEventListener('wheel', onWheel, { passive: false })

    lightboxCleanup = () => {
      cancelCloseTimer()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }

  function removeComposerImage(index) {
    const img = state.images[index]
    if (img && lightboxNode && lightboxNode.dataset.src === composerSrc(img)) closeImageLightbox()
    state.images = state.images.filter((_, i) => i !== index)
    render()
  }

  async function loadSlashCatalog(sessionId) {
    const sid = sessionId || state.session?.sessionId
    if (!sid) return
    try {
      const [cmds, skills] = await Promise.all([
        call('command.list', { sessionId: sid }).catch(() => ({ items: [] })),
        call('skill.list', { sessionId: sid }).catch(() => ({ skills: [] })),
      ])
      chat.slashCommands = Array.isArray(cmds.items) ? cmds.items : []
      chat.slashSkills = Array.isArray(skills.skills) ? skills.skills : []
      if (state.view === 'chat' && state.draft.startsWith('/')) render()
    } catch {
      chat.slashCommands = []
      chat.slashSkills = []
    }
  }

  function parseSlashLine(line) {
    const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)
    if (!match) return null
    return { name: match[1], rest: line.slice(match[0].length) }
  }

  function slashQuery() {
    if (!state.draft.startsWith('/')) return ''
    const parsed = parseSlashLine(state.draft)
    if (parsed && /\s/.test(state.draft)) return parsed.name
    return state.draft.slice(1).toLowerCase()
  }

  function slashMenuGroups() {
    if (!state.draft.startsWith('/')) return { commands: [], skills: [] }
    const q = slashQuery()
    const cmdNames = new Set(chat.slashCommands.map((row) => row.name))
    return {
      commands: chat.slashCommands.filter((row) => !q || row.name.startsWith(q)),
      skills: chat.slashSkills.filter((row) => (!q || row.name.startsWith(q)) && !cmdNames.has(row.name)),
    }
  }

  function pickSlashItem(kind, name) {
    if (kind === 'command') {
      const row = chat.slashCommands.find((item) => item.name === name)
      if (row && row.hint) {
        state.draft = `/${name} `
        render()
        return
      }
      state.draft = `/${name}`
      void send()
      return
    }
    state.draft = `/${name} `
    render()
  }

  function renderSlashMenu() {
    const groups = slashMenuGroups()
    if (groups.commands.length === 0 && groups.skills.length === 0) return null
    const row = (kind, item) => el('button', {
      type: 'button',
      class: 'slash-item',
      onclick: () => { pickSlashItem(kind, item.name) },
    }, [
      el('span', { class: 'slash-item-name' }, [`/${item.name}`]),
      el('span', { class: 'slash-item-desc' }, [item.description || (kind === 'skill' ? '技能' : '命令')]),
    ])
    const kids = []
    if (groups.commands.length) {
      kids.push(el('div', { class: 'slash-group' }, ['命令']))
      for (const item of groups.commands) kids.push(row('command', item))
    }
    if (groups.skills.length) {
      kids.push(el('div', { class: 'slash-group' }, ['技能']))
      for (const item of groups.skills) kids.push(row('skill', item))
    }
    return el('div', { class: 'slash-menu', role: 'listbox', 'aria-label': '斜杠命令' }, kids)
  }

  function openOutbox() {
    const sid = state.session?.sessionId
    if (!sid) return []
    return chat.outbox.filter((item) => item.sessionId === sid)
  }

  function userMessageFromEvent(event) {
    const data = isRecord(event.data) ? event.data : {}
    const source = isRecord(data.source) ? data.source : {}
    const images = imagesFromContent(data.content)
    return {
      kind: 'user',
      text: textFromContent(data.content),
      ...(images.length > 0 ? { images } : {}),
      seq: event.seq,
      time: event.time,
      sourceKind: pickString(source.kind),
    }
  }

  function isEchoOf(item, message) {
    if (!item || !message || message.kind !== 'user' || message.local) return false
    if (message.sourceKind !== undefined && message.sourceKind !== 'user') return false
    if (typeof message.seq === 'number' && typeof item.afterSeq === 'number' && message.seq <= item.afterSeq) return false
    const echo = String(message.text || '').trim()
    const local = String(item.text || '').trim()
    if (local && echo === local) return true
    if (local && echo.includes(local) && ((item.images && item.images.length > 0) || echo.includes('【手机发来的图片】'))) return true
    if (!local && item.images && item.images.length > 0 && ((message.images && message.images.length > 0) || echo.includes('【手机发来的图片】'))) return true
    return false
  }

  function dropOutboxEcho(sessionId, event) {
    if (!sessionId || chat.outbox.length === 0) return false
    const message = userMessageFromEvent(event)
    const index = chat.outbox.findIndex((item) => (
      item.sessionId === sessionId && item.localStatus !== 'failed' && isEchoOf(item, message)
    ))
    if (index === -1) return false
    chat.outbox.splice(index, 1)
    return true
  }

  function reconcileOutbox(sessionId) {
    if (!sessionId || chat.outbox.length === 0) return false
    const used = new Set()
    const next = []
    let changed = false
    for (const item of chat.outbox) {
      if (item.sessionId !== sessionId || item.localStatus === 'failed') {
        next.push(item)
        continue
      }
      const echo = chat.messages.find((message) => !used.has(message.id) && isEchoOf(item, message))
      if (echo) {
        used.add(echo.id)
        changed = true
        continue
      }
      next.push(item)
    }
    if (!changed) return false
    chat.outbox = next
    return true
  }

  function focusComposer() {
    const input = document.querySelector('.chat-input')
    if (input) input.focus({ preventScroll: true })
  }

  function nudgeMux(sessionId) {
    if (!mux || !sessionId) return
    const minSeq = chat.folder && typeof chat.folder.maxSeq === 'function' ? chat.folder.maxSeq() : undefined
    mux.nudge(sessionId, minSeq)
  }

  async function deliverOutbox(item) {
    try {
      await call('session.prompt', { sessionId: item.sessionId, mode: 'queue', content: item.content })
      if (item.localStatus === 'sending') item.localStatus = 'sent'
      if (state.session?.sessionId === item.sessionId) state.running = true
      nudgeMux(item.sessionId)
    } catch (err) {
      item.localStatus = 'failed'
      item.failed = true
      state.error = String(err.message || err)
    }
    if (state.view === 'chat') render()
  }

  async function retryOutbox(item) {
    if (!item || item.localStatus === 'sending' || !state.session) return
    item.localStatus = 'sending'
    item.failed = false
    state.error = ''
    chatScroll.stick = true
    render()
    await deliverOutbox(item)
  }

  async function send() {
    const text = state.draft.trim()
    const images = state.images.slice()
    if ((text === '' && images.length === 0) || !state.session) return

    const parsed = parseSlashLine(text)
    const isCommand = Boolean(parsed && chat.slashCommands.some((row) => row.name === parsed.name) && images.length === 0)

    state.error = ''
    state.draft = ''
    state.images = []
    chatScroll.stick = true

    if (isCommand) {
      state.sending = true
      render()
      focusComposer()
      try {
        const result = await call('command.execute', { sessionId: state.session.sessionId, line: text })
        const outcome = result && result.result
        if (outcome && outcome.kind === 'error' && outcome.text) {
          state.error = outcome.text
          if (state.draft === '' && state.images.length === 0) state.draft = text
        }
      } catch (err) {
        state.error = String(err.message || err)
        if (state.draft === '' && state.images.length === 0) state.draft = text
      } finally {
        state.sending = false
        render()
        focusComposer()
      }
      return
    }

    const last = chat.messages[chat.messages.length - 1]
    const item = {
      id: `local:${rpcId()}`,
      kind: 'user',
      text,
      images: images.map((img) => img.preview).filter(Boolean),
      time: Date.now(),
      local: true,
      localStatus: 'sending',
      sessionId: state.session.sessionId,
      afterSeq: last && typeof last.seq === 'number' ? last.seq : -1,
      content: [
        ...(text ? [{ type: 'text', text }] : []),
        ...images.map((img) => ({
          type: 'image',
          mediaType: img.mediaType,
          data: img.data,
          fullData: img.fullData,
          name: img.name,
        })),
      ],
    }
    chat.outbox.push(item)
    render()
    focusComposer()
    await deliverOutbox(item)
  }

  async function stopTurn() {
    if (!state.session) return
    try { await call('session.cancel', { sessionId: state.session.sessionId }) } catch { /* ignore */ }
    state.running = false
    render()
  }

  /* ── rendering ─────────────────────────────────────────────────────── */

  function messageHtml(m) {
    const cls = ['chat-msg', m.kind === 'user' ? 'chat-msg-user' : 'chat-msg-assistant']
    if (m.pending) cls.push('chat-msg-pending')
    if (m.failed) cls.push('chat-msg-failed')

    if (m.kind === 'user') {
      if (m.local) cls.push('chat-msg-local')
      if (m.localStatus === 'sending') cls.push('chat-msg-sending')
      const status = m.localStatus === 'sending'
        ? '发送中…'
        : m.localStatus === 'sent'
          ? '已发送'
          : formatTime(m.time)
      return el('div', { class: cls.join(' ') }, [
        m.text ? el('div', { class: 'chat-msg-text' }, [m.text]) : null,
        m.images?.length ? el('div', { class: 'chat-msg-images' }, m.images.map((src) => el('button', {
          type: 'button',
          class: 'chat-msg-image-btn',
          'aria-label': '放大查看图片',
          onclick: () => openImageLightbox(src),
        }, [el('img', { src, alt: '' })]))) : null,
        m.localStatus === 'failed'
          ? el('button', {
              type: 'button',
              class: 'chat-msg-failtag chat-msg-retry',
              onclick: () => { void retryOutbox(m) },
            }, ['发送失败，点此重试'])
          : el('span', { class: 'chat-msg-time' }, [status]),
      ])
    }

    const kids = []
    if (m.reasoning) {
      kids.push(el('details', { class: 'chat-disclosure' }, [
        el('summary', { class: 'chat-disclosure-head' }, [
          el('span', { class: 'chat-disclosure-caret' }, ['›']),
          el('span', { class: 'chat-disclosure-label' }, ['深度思考']),
          el('span', { class: 'chat-disclosure-summary' }, [m.reasoning.split('\n')[0].slice(0, 60)]),
        ]),
        el('div', { class: 'chat-disclosure-body' }, [m.reasoning]),
      ]))
    }
    if (chat.showToolCalls && m.tools?.length) {
      const todoTools = []
      const otherTools = []
      for (const tool of m.tools) {
        if (tool.name === 'todo_write') {
          const parsed = parseTodos(tool.arguments)
          if (parsed) {
            todoTools.push(parsed)
            continue
          }
        }
        otherTools.push(tool)
      }
      for (const todos of todoTools) kids.push(renderTodoCard(todos))
      if (otherTools.length > 0) {
        kids.push(el('details', { class: 'chat-disclosure' }, [
          el('summary', { class: 'chat-disclosure-head' }, [
            el('span', { class: 'chat-disclosure-caret' }, ['›']),
            el('span', { class: 'chat-disclosure-label' }, ['工具调用']),
            el('span', { class: 'chat-disclosure-count' }, [`${otherTools.length} 次`]),
          ]),
          el('div', { class: 'chat-disclosure-body chat-tools-body' },
            otherTools.map((tool) => el('div', { class: 'chat-tool-card' }, [
              el('div', { class: 'chat-tool-pills' }, [el('span', { class: 'chat-tool-pill' }, [tool.name])]),
              tool.arguments ? el('pre', { class: 'chat-tool-args' }, [tool.arguments]) : null,
            ]))),
        ]))
      }
    }
    if (m.pending) {
      kids.push(el('div', { class: 'chat-msg-text' }, [m.text || '']))
    } else {
      kids.push(el('div', { class: 'chat-msg-text chat-md chat-md-body', html: renderMarkdown(m.text || '') }))
    }
    if (m.failed) kids.push(el('span', { class: 'chat-msg-failtag' }, ['失败']))
    kids.push(el('span', { class: 'chat-msg-time' }, [formatTime(m.time)]))
    return el('div', { class: cls.join(' ') }, kids)
  }

  /**
   * Injected user messages (sourceKind defined and not 'user') hide behind
   * the system-message toggle — old plugin's exact rule (ChatView.tsx #622).
   */
  function isHiddenSystemMessage(m) {
    return m.kind === 'user'
      && m.sourceKind !== undefined
      && m.sourceKind !== 'user'
      && !chat.showSystemMessages
  }

  function settingsToggleRow(title, desc, value, onToggle) {
    return el('div', { class: 'sheet-toggle-row' }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, [title]),
        el('span', { class: 'sheet-toggle-desc' }, [desc]),
      ]),
      el('button', {
        type: 'button',
        class: `sheet-toggle-switch${value ? ' sheet-toggle-switch-on' : ''}`,
        role: 'switch',
        'aria-checked': String(value),
        'aria-label': title,
        onclick: () => { onToggle(!value) },
      }, [el('span', { class: 'sheet-toggle-switch-knob' })]),
    ])
  }

  /**
   * Unified chat settings: model (drill into ModelSheet) + display toggles +
   * context usage. These are set-and-forget, so they no longer sit above the
   * composer eating vertical space.
   */
  function settingsSheet() {
    const pct = contextUsage()
    const pctWarn = pct !== undefined && pct >= 80
    const model = chat.currentModel
    return el('div', { class: 'sheet-backdrop', onclick: () => { state.sheet = null; state.sheetReturn = null; render() } }, [
      el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '设置', onclick: (ev) => { ev.stopPropagation() } }, [
        el('div', { class: 'sheet-handle' }),
        el('div', { class: 'sheet-title' }, ['设置']),
        el('div', { class: 'sheet-body' }, [
          el('div', { class: 'sheet-section' }, [
            el('div', { class: 'sheet-section-title' }, ['模型']),
            el('button', {
              type: 'button',
              class: 'sheet-nav-row',
              'aria-haspopup': 'dialog',
              'aria-label': '选择模型与思考强度',
              onclick: () => void openModelSheet(),
            }, [
              el('div', { class: 'sheet-toggle-copy' }, [
                el('span', { class: 'sheet-toggle-title' }, [model?.model || '选择模型']),
                el('span', { class: 'sheet-toggle-desc' }, [
                  model?.reasoningEffort
                    ? `思考强度 ${model.reasoningEffort}`
                    : '更换模型或思考强度',
                ]),
              ]),
              el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['›']),
            ]),
            el('div', { class: 'sheet-toggle-row' }, [
              el('div', { class: 'sheet-toggle-copy' }, [
                el('span', { class: 'sheet-toggle-title' }, ['上下文占用']),
                el('span', { class: 'sheet-toggle-desc' }, [
                  pct === undefined
                    ? '等模型回复后才会显示'
                    : (pctWarn ? '接近上限，考虑新开会话' : '当前会话已用上下文窗口比例'),
                ]),
              ]),
              el('span', {
                class: pctWarn ? 'sheet-context-value sheet-context-value-warn' : 'sheet-context-value',
              }, [pct === undefined ? '—' : `${pct}%`]),
            ]),
          ]),
          el('div', { class: 'sheet-section' }, [
            el('div', { class: 'sheet-section-title' }, ['显示']),
            settingsToggleRow('工具调用', '在消息里显示工具调用折叠块', chat.showToolCalls, (v) => {
              chat.showToolCalls = v
              writeStoredBoolean('dsh.mobile.showToolCalls', v)
              render()
            }),
            settingsToggleRow('显示系统消息', '显示宿主注入的系统提示消息（默认隐藏）', chat.showSystemMessages, (v) => {
              chat.showSystemMessages = v
              writeStoredBoolean('dsh.mobile.showSystemMessages', v)
              render()
            }),
          ]),
          el('div', { class: 'sheet-section' }, [
            el('div', { class: 'sheet-section-title' }, ['额度']),
            el('button', {
              type: 'button',
              class: 'sheet-nav-row',
              'aria-haspopup': 'dialog',
              'aria-label': '查看 DeepSeek 余额与 Grok 剩余额度',
              onclick: () => openQuotaSheet(),
            }, [
              el('div', { class: 'sheet-toggle-copy' }, [
                el('span', { class: 'sheet-toggle-title' }, ['DeepSeek / Grok']),
                el('span', { class: 'sheet-toggle-desc' }, [quotaSummary()]),
              ]),
              el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['›']),
            ]),
          ]),
        ]),
      ]),
    ])
  }

  /** 打开模型与思考强度弹层：每次打开都拉最新模型目录（老插件 ModelSheet 行为）。 */
  function openModelSheet() {
    if (state.sheet === 'settings') state.sheetReturn = 'settings'
    state.sheet = 'model'
    chat.modelSheet = { status: 'loading' }
    chat.modelError = undefined
    render()
    void call('session.models', { sessionId: state.session.sessionId }).then(
      (data) => { chat.modelSheet = { status: 'ready', data }; render() },
      (err) => { chat.modelSheet = { status: 'error', message: String(err.message || err) }; render() },
    )
  }

  /**
   * 模型与思考强度弹层（老插件 ModelSheet 的忠实移植）：分组模型 +
   * 思考强度（含「跟随模型默认」），选中即提交 session.selectModel。
   * 从设置钻入时，取消/选中后回到设置，而不是直接关掉。
   */
  function renderModelSheet() {
    const backToSettings = () => {
      state.sheetReturn = null
      state.sheet = 'settings'
      render()
    }
    const dismiss = () => {
      state.sheetReturn = null
      state.sheet = null
      render()
    }
    const close = state.sheetReturn === 'settings' ? backToSettings : dismiss
    const sheet = (kids) => el('div', { class: 'sheet-backdrop', onclick: close }, [
      el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '模型与思考强度', onclick: (ev) => { ev.stopPropagation() } }, [
        el('div', { class: 'sheet-handle' }),
        el('div', { class: 'sheet-title sheet-title-nav' }, [
          state.sheetReturn === 'settings'
            ? el('button', { type: 'button', class: 'sheet-back', 'aria-label': '返回设置', onclick: (ev) => { ev.stopPropagation(); backToSettings() } }, ['‹'])
            : null,
          '模型与思考强度',
        ]),
        el('div', { class: 'sheet-body' }, kids),
      ]),
    ])

    const ms = chat.modelSheet
    if (ms.status === 'loading') {
      return sheet([el('div', { class: 'sheet-status' }, ['正在加载模型目录…'])])
    }
    if (ms.status === 'error') {
      return sheet([
        el('div', { class: 'sheet-status sheet-status-error' }, [
          el('span', {}, [ms.message]),
          el('button', { type: 'button', class: 'chat-load-older', onclick: () => void openModelSheet() }, ['重试']),
        ]),
      ])
    }

    const { data } = ms
    const selected = chat.currentModel ?? data.current
    const choices = (data.groups || []).flatMap((group) => group.models.map((model) => ({ group, model })))
    const currentChoice = choices.find((c) => c.group.id === selected.provider && c.model.id === selected.model)
    const reasoning = currentChoice?.model.reasoning
    const effectiveEffort = selected.reasoningEffort ?? reasoning?.defaultEffort
    const effortChoices = reasoning === undefined
      ? []
      : [
          ...(reasoning.defaultEffort === undefined
            ? [{ key: 'provider-default', effort: undefined, label: '跟随模型默认' }]
            : []),
          ...reasoning.efforts.map((effort) => ({
            key: `effort:${effort.id}`,
            effort: effort.id,
            label: effort.name,
            description: effort.description,
          })),
        ]

    const option = (isSelected, kids, onPick) => el('button', {
      type: 'button',
      class: `sheet-option${isSelected ? ' sheet-option-selected' : ''}`,
      disabled: chat.modelBusy,
      onclick: () => void onPick(),
    }, [
      el('span', { class: 'sheet-option-copy' }, kids),
      isSelected ? el('span', { class: 'sheet-option-check', 'aria-hidden': 'true' }, ['√']) : null,
    ])

    const apply = async (selection) => {
      if (chat.modelBusy) return
      chat.modelBusy = true
      chat.modelError = undefined
      render()
      try {
        const result = await call('session.selectModel', {
          sessionId: state.session.sessionId,
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
        })
        chat.modelBusy = false
        chat.currentModel = result.selected
        close()
      } catch (err) {
        chat.modelBusy = false
        chat.modelError = String(err.message || err)
        render()
      }
    }

    const kids = []
    if (chat.modelError !== undefined) kids.push(el('p', { class: 'sheet-error' }, [chat.modelError]))
    for (const failure of data.failures || []) {
      kids.push(el('p', { class: 'sheet-error' }, [`${failure.name}: ${failure.message}`]))
    }
    if ((data.groups || []).length === 0 && choices.length === 0) {
      kids.push(el('div', { class: 'sheet-status' }, ['没有可用的模型']))
    }
    for (const group of data.groups || []) {
      const rows = group.models.map((model) => {
        const isSelected = selected.provider === group.id && selected.model === model.id
        return option(isSelected, [
          el('span', { class: 'sheet-option-title' }, [model.name]),
          model.description !== undefined ? el('span', { class: 'sheet-option-desc' }, [model.description]) : null,
        ], () => apply({
          provider: group.id,
          model: model.id,
          ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
        }))
      })
      kids.push(el('div', { class: 'sheet-section' }, [
        el('div', { class: 'sheet-section-title' }, [group.name]),
        ...rows,
      ]))
    }
    if (effortChoices.length > 0) {
      kids.push(el('div', { class: 'sheet-section' }, [
        el('div', { class: 'sheet-section-title' }, ['思考强度']),
        ...effortChoices.map((choice) => option(effectiveEffort === choice.effort, [
          el('span', { class: 'sheet-option-title' }, [choice.label]),
          choice.description !== undefined ? el('span', { class: 'sheet-option-desc' }, [choice.description]) : null,
        ], () => apply({
          provider: selected.provider,
          model: selected.model,
          ...(choice.effort !== undefined ? { reasoningEffort: choice.effort } : {}),
        }))),
      ]))
    }
    return sheet(kids)
  }

  function renderChat() {
    // Opening a session (null key) pins to the bottom. After that, stick only
    // while the user is already near the bottom — never yank a reader back to
    // the top, and never fight a deliberate upward scroll.
    const localPending = openOutbox()
    const last = localPending.length ? localPending[localPending.length - 1] : chat.messages[chat.messages.length - 1]
    const lastId = last === undefined ? undefined : last.id
    if (lastMsgScrollKey === null) chatScroll.stick = true
    if (lastId !== undefined) lastMsgScrollKey = lastId

    const scroller = el('div', { class: 'chat-scroll', onscroll: onChatScroll })
    if (chat.hasOlder) {
      scroller.append(el('button', { type: 'button', class: 'chat-load-older', onclick: () => void loadOlder() }, ['加载更早消息']))
    }
    if (chat.loading && chat.messages.length === 0 && localPending.length === 0) {
      scroller.append(el('div', { class: 'chat-typing' }, ['加载中…']))
    }
    let visible = 0
    for (const m of chat.messages) {
      if (isHiddenSystemMessage(m)) continue
      visible += 1
      scroller.append(messageHtml(m))
    }
    for (const m of localPending) {
      visible += 1
      scroller.append(messageHtml(m))
    }
    if (visible === 0 && !chat.loading) {
      scroller.append(el('div', { class: 'chat-typing' }, ['还没有消息，发一句试试']))
    }
    for (const approval of chat.approvals) scroller.append(renderApprovalPanel(approval))
    for (const group of chat.questions) scroller.append(renderQuestionPanel(group))

    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, onchange: onPickFile })
    const pics = state.images.length
      ? el('div', { class: 'composer-pics' }, state.images.map((img, idx) => el('div', { class: 'composer-pic' }, [
          el('button', {
            type: 'button',
            class: 'composer-pic-open',
            'aria-label': img.name ? `放大查看 ${img.name}` : '放大查看即将发送的图片',
            onclick: () => openImageLightbox(composerSrc(img)),
          }, [el('img', { src: img.preview, alt: img.name || '' })]),
          el('button', {
            type: 'button',
            class: 'composer-pic-remove',
            'aria-label': '移除图片',
            onclick: (ev) => { ev.stopPropagation(); removeComposerImage(idx) },
          }, ['×']),
        ])))
      : null

    const page = el('div', { class: 'mobile chat' }, [
      el('header', { class: 'mobile-header' }, [
        el('button', { type: 'button', class: 'mobile-back', 'aria-label': '返回', onclick: () => navBack(state.workspace ? { view: 'sessions', workspaceId: state.workspace.workspaceId } : { view: 'workspaces' }) }, ['‹']),
        el('h1', {
          class: 'mobile-title mobile-titleInline',
          title: state.session ? sessionTitle(state.session) : '聊天',
        }, [state.session ? sessionTitle(state.session) : '聊天']),
        themeToggle(),
        settingsButton(),
      ]),
      state.error ? el('p', { class: 'mobile-error mobile-pad' }, [state.error]) : null,
      state.running ? el('div', { class: 'chat-turn-status' }, [
        el('span', { class: 'chat-turn-dots' }, [el('span'), el('span'), el('span')]),
        '正在输出',
      ]) : null,
      scroller,
      renderTodoDock(standingTodos()),
      pics,
      renderSlashMenu(),
      el('div', { class: 'chat-inputbar' }, [
        el('textarea', {
          class: 'chat-input',
          placeholder: '输入消息，/ 调用命令或技能',
          enterkeyhint: composerReturnIsNewline() ? 'enter' : 'send',
          value: state.draft,
          oninput: (ev) => {
            const prev = state.draft
            state.draft = ev.target.value
            autosizeInput(ev.target)
            if (state.draft.startsWith('/') || prev.startsWith('/')) render()
          },
          onkeydown: (ev) => {
            if (composerReturnIsNewline()) return
            if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
              ev.preventDefault()
              void send()
            }
          },
        }),
        el('label', { class: 'pic-btn' }, ['图片', file]),
        state.running
          ? el('button', { type: 'button', class: 'chat-send chat-send-stop', disabled: state.sending, onclick: () => void stopTurn() }, ['■'])
          : el('button', { type: 'button', class: 'chat-send', disabled: state.sending, onclick: () => void send() }, [state.sending ? '发送中…' : '发送']),
      ]),
      state.sheet === 'model' ? renderModelSheet() : state.sheet === 'settings' ? settingsSheet() : state.sheet === 'quota' ? quotaSheet() : null,
    ])
    return page
  }

  function renderSessions() {
    const old = state.workspace
    const page = el('div', { class: 'mobile' }, [
      el('header', { class: 'mobile-header' }, [
        el('button', { type: 'button', class: 'mobile-back', 'aria-label': '返回', onclick: () => navBack({ view: 'workspaces' }) }, ['‹']),
        el('h1', { class: 'mobile-title mobile-titleInline' }, [old ? workspaceTitle(old) : '会话']),
        themeToggle(),
      ]),
    ])
    const quotaBar = renderQuotaBar()
    if (quotaBar) page.append(quotaBar)
    if (state.sheet === 'quota') page.append(quotaSheet())

    if (state.loading && state.sessions.length === 0 && !state.error) {
      page.append(el('div', { class: 'mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['加载中…'])]))
      return page
    }

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

    const list = el('ul', { class: 'mobile-list', onscroll: onListScroll })
    for (const raw of state.sessions) {
      const s = decorateSession(raw)
      list.append(el('li', {}, [
        el('button', { type: 'button', class: 'mobile-row', onclick: () => { void openChat(s) } }, [
          el('span', { class: 'mobile-rowMain' }, [
            el('span', { class: 'mobile-rowTitle' }, [s.blank ? '新会话' : sessionTitle(s)]),
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
      page.append(el('div', { class: 'mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['该工作区还没有会话，点上方按钮新建一个'])]))
    }
    return page
  }

  function renderWorkspaces() {
    const page = el('div', { class: 'mobile' }, [
      el('header', { class: 'mobile-header' }, [
        el('h1', { class: 'mobile-title' }, ['工作区']),
        themeToggle(),
      ]),
    ])
    if (!isStandalone()) {
      page.append(el('p', { class: 'mobile-pwa-hint' }, ['Safari 分享 → 添加到主屏幕，下次可以当 App 打开（需 HTTPS）。']))
    }
    const quotaBar = renderQuotaBar()
    if (quotaBar) page.append(quotaBar)
    if (state.sheet === 'quota') page.append(quotaSheet())
    if (state.createError) {
      page.append(el('p', { class: 'mobile-error' }, [state.createError]))
    }
    if (state.loading && state.workspaces.length === 0) {
      page.append(el('div', { class: 'mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['加载中…'])]))
      return page
    }
    const list = el('ul', { class: 'mobile-list' })
    for (const ws of state.workspaces) {
      const name = workspaceTitle(ws)
      const pathLabel = abbreviateHomePath(ws.path)
      list.append(el('li', {}, [
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
      ]))
    }
    page.append(list)
    page.append(el('div', { class: 'pad16' }, [
      state.todayAvailable
        ? el('button', { type: 'button', class: 'mobile-button', disabled: state.creating, onclick: () => void openToday() }, [state.creating ? '打开中…' : '今天'])
        : null,
      el('button', { type: 'button', class: 'mobile-button', onclick: () => enterDir() }, ['+ 新建工作区']),
    ]))
    return page
  }

  async function openDir(path) {
    state.dir = null
    state.dirError = ''
    render()
    try {
      state.dir = await call('host.listDirectory', path === undefined ? {} : { path })
      if (state.dir && typeof state.dir.home === 'string' && state.dir.home) state.home = state.dir.home
    } catch (err) {
      state.dirError = String(err.message || err)
    }
    render()
  }

  function renderDir() {
    const dir = state.dir
    const page = el('div', { class: 'mobile dir-browser' }, [
      el('header', { class: 'mobile-header' }, [
        el('button', { type: 'button', class: 'mobile-back', 'aria-label': '返回', onclick: () => navBack({ view: 'workspaces' }) }, ['‹']),
        el('h1', { class: 'mobile-title' }, ['选择目录']),
      ]),
    ])
    if (state.dirError) {
      page.append(el('div', { class: 'mobile-empty' }, [
        el('p', { class: 'mobile-error' }, [state.dirError]),
        el('button', { type: 'button', class: 'mobile-button', onclick: () => { state.dirError = ''; render(); void openDir(dir?.path) } }, ['重试']),
      ]))
      return page
    }
    if (!dir) {
      page.append(el('div', { class: 'mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['加载中…'])]))
      return page
    }
    const crumbs = el('div', { class: 'dir-crumbs' })
    for (let idx = 0; idx < (dir.crumbs || []).length; idx += 1) {
      const crumb = dir.crumbs[idx]
      crumbs.append(el('button', { type: 'button', class: 'dir-crumb', onclick: () => void openDir(crumb.path) }, [crumb.name || '/']))
      if (idx < dir.crumbs.length - 1) crumbs.append(el('span', { class: 'dir-crumb-separator' }, ['/']))
    }
    page.append(crumbs)
    const list = el('ul', { class: 'mobile-list' })
    if (!dir.entries || dir.entries.length === 0) {
      list.append(el('div', { class: 'mobile-empty dir-empty' }, [el('p', { class: 'mobile-muted' }, ['空目录'])]))
    } else {
      for (const entry of dir.entries) {
        list.append(el('li', {}, [
          el('button', { type: 'button', class: `mobile-row dir-entry${entry.hidden ? ' dir-entry-hidden' : ''}`, onclick: () => void openDir(entry.path) }, [
            el('span', { class: 'mobile-rowTitle' }, [entry.name]),
          ]),
        ]))
      }
    }
    page.append(list)
    page.append(el('div', { class: 'dir-select' }, [
      el('button', { type: 'button', class: 'mobile-button', onclick: async () => {
        try {
          const result = await call('workspace.create', { path: dir.path })
          await openWorkspace(result.workspace, { locationMode: 'replace' })
        } catch (err) {
          state.dirError = String(err.message || err)
          render()
        }
      } }, ['选择此目录']),
    ]))
    return page
  }

  function renderPair() {
    const input = el('input', {
      id: 'mobile-pair-link', class: 'mobile-pairInput',
      placeholder: 'http://your-relay-host/mp/?pair=…',
      autocomplete: 'off',
    })
    const form = el('form', { class: 'mobile-pairCard' }, [
      el('img', { class: 'pair-logo', src: '/mp/logo.svg', alt: '' }),
      el('h1', { class: 'mobile-title', id: 'mobile-pair-title' }, ['设备配对']),
      el('p', { class: 'mobile-muted' }, ['粘贴桌面端复制的配对链接以连接此设备。']),
      el('label', { class: 'mobile-pairLabel', for: 'mobile-pair-link' }, ['配对链接']),
      input,
      state.dirError ? el('p', { class: 'mobile-error', role: 'alert' }, [state.dirError]) : null,
      el('button', { type: 'submit', class: 'mobile-new mobile-pairSubmit', disabled: state.creating }, ['配对']),
    ])
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault()
      const token = parsePairInput(input.value)
      if (!token) {
        state.dirError = '请输入有效的配对链接。'
        render()
        return
      }
      state.creating = true
      render()
      const message = await acceptPair(token)
      state.creating = false
      if (message) {
        state.dirError = message
        render()
        return
      }
      stripPairQuery()
      await enterApp()
    })
    return el('main', { class: 'mobile mobile-pair' }, [form])
  }

  async function probeToday() {
    try {
      const res = await fetch('/dsh-today/info', { credentials: 'same-origin' })
      state.todayAvailable = res.ok
    } catch {
      state.todayAvailable = false
    }
  }

  async function openToday() {
    if (state.creating) return
    state.creating = true
    state.createError = ''
    render()
    try {
      const res = await fetch('/dsh-today/open', { method: 'POST', credentials: 'same-origin' })
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

  async function enterApp() {
    state.error = ''
    state.loading = true
    if (state.view !== 'boot') {
      state.view = 'boot'
      render()
    }
    try {
      await probeToday()
      await loadWorkspaces()
      await loadPresets()
      await ensureMux()
      await ensureHost()
      startListPoll()
      void loadQuota(false)
      await restoreRoute()
      if (state.view !== 'error') state.loading = false
    } catch (err) {
      state.error = String(err.message || err)
      state.view = 'error'
      state.loading = false
      render()
    }
  }

  function render() {
    if (state.view !== 'chat') closeImageLightbox()
    if (state.view === 'boot') {
      rootEl.replaceChildren(el('main', { class: 'mobile mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['正在连接…'])]))
      return
    }
    if (state.view === 'error') {
      rootEl.replaceChildren(el('main', { class: 'mobile mobile-empty' }, [
        el('p', { class: 'mobile-error', role: 'alert' }, [state.error || '无法连接到运行中的 DSH host。']),
        el('button', { type: 'button', class: 'mobile-new', onclick: () => void boot() }, ['重试']),
      ]))
      return
    }
    if (state.view === 'pair') {
      rootEl.replaceChildren(renderPair())
      return
    }
    if (state.view === 'workspaces') {
      rootEl.replaceChildren(renderWorkspaces())
      return
    }
    if (state.view === 'dir') {
      rootEl.replaceChildren(renderDir())
      return
    }
    if (state.view === 'sessions') {
      captureListScroll()
      const page = renderSessions()
      rootEl.replaceChildren(page)
      applyListScroll(page.querySelector('.mobile-list'))
      return
    }
    if (state.view === 'chat') {
      const active = document.activeElement
      const restoreInput = active && active.classList && active.classList.contains('chat-input')
        ? { start: active.selectionStart, end: active.selectionEnd }
        : null
      captureChatScroll()
      captureTodoScroll()
      const page = renderChat()
      rootEl.replaceChildren(page)
      applyChatScroll(page.querySelector('.chat-scroll'))
      applyTodoScroll(page.querySelector('.todo-dock-list'))
      if (restoreInput) {
        const input = page.querySelector('.chat-input')
        if (input) {
          input.focus({ preventScroll: true })
          try { input.setSelectionRange(restoreInput.start, restoreInput.end) } catch { /* ignore */ }
        }
      }
      autosizeInput(page.querySelector('.chat-input'))
      return
    }
  }

  /* ── boot ──────────────────────────────────────────────────────────── */

  async function boot() {
    state.view = 'boot'
    render()
    try {
      const paired = await pairStatus()
      if (paired) {
        await enterApp()
        return
      }
      const token = parsePairInput(window.location.href)
      if (token) {
        const message = await acceptPair(token)
        if (message) {
          state.dirError = message
        } else {
          stripPairQuery()
          await enterApp()
          return
        }
      }
      state.view = 'pair'
      render()
    } catch (err) {
      state.error = String(err.message || err)
      state.view = 'error'
      render()
    }
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  }

  function registerPwa() {
    if (!navigator.serviceWorker) return
    navigator.serviceWorker.register('/mp/sw.js', { scope: '/mp/', updateViaCache: 'none' }).catch(() => {})
  }

  applyTheme()
  pinViewport()
  installOverscrollLock()
  registerPwa()
  window.addEventListener('popstate', () => {
    if (ignoringPop) return
    if (state.view === 'boot' || state.view === 'pair') return
    const route = (history.state && history.state.mp) || parseRoute(window.location.hash)
    void applyRoute(route, { fromPopstate: true })
  })
  function onForeground() {
    if (mux) mux.wake()
    if (host) host.wake()
    void loadQuota(false)
    void refreshLiveSnapshot()
    if (state.view === 'chat' && state.session) {
      if (mux) mux.nudge(state.session.sessionId)
      void refreshPending()
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onForeground()
  })
  window.addEventListener('pageshow', () => { onForeground() })
  window.addEventListener('online', () => { onForeground() })
  render()
  void boot()
})()
