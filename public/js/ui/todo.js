/**
 * TodoDock standing plan panel and event projections.
 */
import { state, chat, runtime } from '../state/state.js'
import { el } from '../utils/dom.js'
import { writeStoredBoolean } from '../utils/storage.js'
import { render } from './views/render.js'

export function todoStatusOf(value) {
    if (value === 'completed' || value === 'done' || value === 'complete') return 'completed'
    if (value === 'in_progress' || value === 'in-progress' || value === 'running' || value === 'active') return 'in_progress'
    return 'pending'
  }

export function parseTodos(raw) {
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

export function completedGlyph() {
    return el('span', {
      class: 'todo-glyph todo-glyph-completed',
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6.4" stroke="currentColor" stroke-width="1.2"/><path d="M10.9631 5.71411L7.70154 8.97571C7.48011 9.19714 7.27736 9.40099 7.09229 9.54993C6.89742 9.70669 6.66314 9.85279 6.3634 9.90027C6.2049 9.92534 6.04339 9.92534 5.88489 9.90027C5.58515 9.85279 5.35087 9.70669 5.15601 9.54993C4.97093 9.40099 4.76818 9.19714 4.54675 8.97571L3.03516 7.46411L3.96313 6.53613L5.47473 8.04773C5.7169 8.28989 5.86196 8.43389 5.97888 8.52795C6.08597 8.61409 6.10875 8.60701 6.08997 8.604C6.11259 8.60758 6.13571 8.60758 6.15833 8.604C6.13954 8.60701 6.16232 8.61409 6.26941 8.52795C6.38633 8.43389 6.53139 8.28989 6.77356 8.04773L10.0352 4.78613L10.9631 5.71411Z" fill="currentColor"/></svg>',
    })
  }

export function progressGlyph() {
    const id = `todo-grad-${++svgUid}`
    return el('span', {
      class: 'todo-glyph todo-glyph-progress',
      html: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="2.5" y1="12" x2="10.5" y2="3.5" gradientUnits="userSpaceOnUse"><stop stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><circle cx="7" cy="7" r="6.4" stroke="url(#${id})" stroke-width="1.2"/></svg>`,
    })
  }

export function pendingGlyph() {
    return el('span', {
      class: 'todo-glyph todo-glyph-pending',
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="6.4" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.4 2.4"/></svg>',
    })
  }

export function statusGlyph(status) {
    if (status === 'completed') return completedGlyph()
    if (status === 'in_progress') return progressGlyph()
    return pendingGlyph()
  }

export function todoProgressLabel(todos) {
    const done = todos.filter((item) => item.status === 'completed').length
    const active = todos.filter((item) => item.status === 'in_progress').length
    const pending = todos.length - done - active
    const parts = []
    if (done > 0) parts.push(`${done} 已完成`)
    if (active > 0) parts.push(`${active} 进行中`)
    if (pending > 0) parts.push(`${pending} 待处理`)
    return parts.join(' · ')
  }

export function todoList(todos) {
    return el('ul', { class: 'todo-dock-list', onscroll: onTodoScroll }, todos.map((item) => (
      el('li', { class: 'todo-item', 'data-status': item.status }, [
        statusGlyph(item.status),
        el('span', { class: 'todo-content' }, [item.content]),
      ])
    )))
  }

export function checklistIcon() {
    return el('span', {
      class: 'todo-dock-lead',
      html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.6" y="1.6" width="14.8" height="14.8" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M4.6 9.3 7.1 11.8 13.4 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    })
  }

export function chevronIcon() {
    return el('span', {
      class: 'todo-dock-chevron',
      'aria-hidden': 'true',
      html: '<svg viewBox="0 0 20 20" fill="none"><path d="M4.4 7.4 10 13 15.6 7.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    })
  }

export function toggleTodoDock(ev) {
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

export function renderTodoDock(todos) {
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

export function renderTodoCard(todos) {
    return el('div', { class: 'chat-todo-card' }, [
      el('div', { class: 'todo-dock-header' }, [
        checklistIcon(),
        el('span', { class: 'todo-dock-title' }, ['更新任务清单']),
        el('span', { class: 'todo-dock-progress' }, [`${todos.filter((t) => t.status === 'completed').length}/${todos.length} 已完成`]),
      ]),
      todoList(todos),
    ])
  }

export function standingTodos() {
    return Array.isArray(chat.todos) ? chat.todos : []
  }

export function applyStandingTodoEvent(list, ev) {
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

export function todosFromEvents(events) {
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

export function normalizeTodos(value) {
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

export function todosFromProjections(page) {
    const values = page?.projections?.values
    if (!values || !Object.hasOwn(values, 'todos')) return null
    // Host sends null before the first write and again on each turn/start.
    // That is a real empty standing plan — do not resurrect an older list.
    return normalizeTodos(values.todos) ?? []
  }

export function projectionAsOfSeq(page) {
    return typeof page?.projections?.asOfSeq === 'number' ? page.projections.asOfSeq : undefined
  }

export function applyTodoEventsAfter(list, events, afterSeq) {
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

export function acceptTodoSeq(sessionId, seq) {
    if (typeof seq !== 'number') return true
    const prev = todoWatermark.get(sessionId)
    if (prev !== undefined && seq < prev) return false
    if (prev === undefined || seq > prev) todoWatermark.set(sessionId, seq)
    return true
  }

export function seedTodosFromPage(sessionId, page, extraEvents) {
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

export function applyTodosProjection(sessionId, value, seq) {
    if (sessionId !== state.session?.sessionId) return false
    if (!acceptTodoSeq(sessionId, seq)) return false
    chat.todos = normalizeTodos(value) ?? []
    return true
  }

export function isStandingTodoEvent(ev) {
    if (!ev || typeof ev.type !== 'string') return false
    if (ev.type === 'turn/start' || ev.type === 'todo/write') return true
    if (ev.type !== 'tool/call') return false
    const data = isRecord(ev.data) ? ev.data : {}
    return pickString(data.name) === 'todo_write'
  }

export function applyTodosLiveEvent(sessionId, ev) {
    if (!isStandingTodoEvent(ev)) return false
    if (!acceptTodoSeq(sessionId, typeof ev.seq === 'number' ? ev.seq : undefined)) return false
    chat.todos = applyStandingTodoEvent(Array.isArray(chat.todos) ? chat.todos : [], ev)
    return true
  }
