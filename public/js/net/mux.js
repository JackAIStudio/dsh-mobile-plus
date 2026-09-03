/**
 * Live multiplexing and host event subscriptions.
 */
import { state, chat, runtime } from '../state/state.js'
import { call } from './rpc.js'
import { loadQuota } from './quota.js'
import { stopPendingPoll } from './pending.js'
import { foldEvents, applySessionTitle, isRecord, toWireEvent } from '../chat/fold.js'
import { applyTodosLiveEvent, isStandingTodoEvent, applyTodosProjection } from '../ui/todo.js'
import { applySessionLive, applyPendingFrame, ensureLive } from './pending.js'
import { dropOutboxEcho, reconcileOutbox } from '../chat/outbox.js'
import { refreshLiveSnapshot } from '../ui/views/session-view.js'
import { render } from '../ui/views/render.js'
import { triggerTaskDoneNotification, notifyIfCompleted } from '../utils/notify.js'

export function parseLiveFrame(data) {
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
    } else if (typeof parsed.rpcId === 'string' && isRecord(parsed.payload) && typeof parsed.payload.type === 'string') {
      // 宿主 events.mux / events.host 内部迭代器产出窄格式 { rpcId, payload }（无外层
      // type；0.1.1-rc.2 起如此）。PC 端 fetch client 在 readSse 里用 schema 双层解析
      // （serverRequestSchema + frameSchema），手机端这里同样解包，否则所有 live 帧
      // 都被丢弃——question/requested 也因此永远到不了问题面板。
      frame = { ...parsed.payload, rpcId: parsed.rpcId }
    }
    if (!isRecord(frame) || typeof frame.type !== 'string') return null
    return frame
  }

export class MuxClient {
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

export class HostClient {
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

export async function ensureMux() {
    if (runtime.mux !== null) return
    runtime.mux = new MuxClient('/mp/api/events.mux', {
      pollLatest: (sessionId) => call('session.history', { sessionId, maxMessages: 50 }),
    })
    runtime.mux.onFrame(handleMuxFrame)
    runtime.mux.start()
  }

export async function ensureHost() {
    if (runtime.host !== null) return
    runtime.host = new HostClient('/mp/api/events.host')
    runtime.host.onFrame(handleMuxFrame)
    runtime.host.start()
  }

export function handleMuxFrame(frame) {
    const pendingChanged = applyPendingFrame(frame)
    if (pendingChanged && state.view === 'chat') render()
    const liveBefore = typeof frame?.sessionId === 'string' ? runtime.sessionLive.get(frame.sessionId) : undefined
    const statusChanged = applySessionLive(frame)
    // Any session (mobile-open or PC-side) finishing triggers the chime +
    // notification; notify.js dedupes the overlapping trigger paths.
    notifyIfCompleted(frame, liveBefore?.running === true)
    if (frame?.type === 'host/session-status' && typeof frame.sessionId === 'string') {
      if (frame.sessionId === state.session?.sessionId) {
        const next = frame.running === true
        if (state.running !== next) {
          const wasRunning = state.running
          state.running = next
          if (wasRunning && !next) {
            void loadQuota(true)
            triggerTaskDoneNotification(state.session?.title || '会话', frame.sessionId)
          }
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

export function stopMuxObservation() {
    stopPendingPoll()
    if (runtime.mux !== null) runtime.mux.observe(undefined)
  }

export function nudgeMux(sessionId) {
    if (!runtime.mux || !sessionId) return
    const minSeq = chat.folder && typeof chat.folder.maxSeq === 'function' ? chat.folder.maxSeq() : undefined
    runtime.mux.nudge(sessionId, minSeq)
  }
