/**
 * Session status and pending action tracking.
 */
import { state, chat, runtime } from '../state/state.js'
import { el } from '../utils/dom.js'
import { call } from './rpc.js'
import { render } from '../ui/views/render.js'

export function ensureLive(sessionId) {
    let row = runtime.sessionLive.get(sessionId)
    if (!row) {
      row = {
        running: false,
        prevRunning: undefined,
        completed: false,
        liveAt: 0,
        pending: new Map(),
      }
      runtime.sessionLive.set(sessionId, row)
    }
    return row
  }

export function questionInteractionStatus(questions) {
    if (!Array.isArray(questions) || questions.length !== 1) return 'question'
    const question = questions[0]
    const intent = question && question.intent
    if (!intent || intent.kind !== 'plan-review' || question.detail === undefined) return 'question'
    if (question.multiSelect === true) return 'question'
    const options = question.options ?? []
    if (options.length > 2) return 'question'
    return options.some((option) => option.label === intent.approve) ? 'plan-review' : 'question'
  }

export function primaryPending(row) {
    let best
    for (const status of row.pending.values()) {
      if (status === 'approval') return 'approval'
      if (status === 'plan-review') best = 'plan-review'
      else if (best === undefined) best = status
    }
    return best
  }

export function pendingLabel(kind) {
    if (kind === 'approval') return '等待审批'
    if (kind === 'plan-review') return '计划待审'
    return '等待回答'
  }

export function hydrateSessionLive(item, listedAt = 0) {
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

export function decorateSession(item) {
    const row = runtime.sessionLive.get(item.sessionId)
    if (!row) return item
    return {
      ...item,
      running: row.running === true,
      completed: row.completed === true,
      pendingInteraction: primaryPending(row),
    }
  }

export function sessionStatusOf(item) {
    const pending = item.pendingInteraction
    if (pending) return { state: 'warning', label: pendingLabel(pending) }
    if (item.running) return { state: 'ongoing', label: '进行中' }
    if (item.completed) return { state: 'done', label: '已完成' }
    return null
  }

export function sessionStatusDot(item) {
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

export function applySessionLive(frame) {
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

export function applyPendingFrame(frame) {
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

export function mergePendingSnapshot(snapshot) {
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

export function pendingSignature() {
    const approvals = chat.approvals.map((row) => `${row.rpcId}:${row.busy ? 1 : 0}:${row.error || ''}`).join(',')
    const questions = chat.questions.map((row) => `${row.rpcId}:${row.busy ? 1 : 0}:${row.error || ''}:${(row.questions || []).length}`).join(',')
    return `${approvals}#${questions}`
  }

export async function refreshPending() {
    if (!state.session || state.view !== 'chat') return
    try {
      const snapshot = await call('mobile.pending', { sessionId: state.session.sessionId })
      const before = pendingSignature()
      mergePendingSnapshot(snapshot)
      if (state.view === 'chat' && pendingSignature() !== before) render()
    } catch {
      /* polling fallback is best-effort */
    }
  }

export function startPendingPoll(forceImmediate = true) {
    stopPendingPoll()
    if (forceImmediate) void refreshPending()
    if (runtime.mux && runtime.mux.sseAlive) return
    runtime.pendingPoll = setInterval(() => {
      if (runtime.mux && runtime.mux.sseAlive) {
        stopPendingPoll()
        return
      }
      void refreshPending()
    }, 10_000)
  }

export function stopPendingPoll() {
    if (runtime.pendingPoll !== null) {
      clearInterval(runtime.pendingPoll)
      runtime.pendingPoll = null
    }
  }
