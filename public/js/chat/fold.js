/**
 * Message fold and event compaction algorithms.
 */
import { state, runtime } from '../state/state.js'
import { basename } from '../utils/dom.js'

export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

export function pickString(value) {
    return typeof value === 'string' ? value : undefined
  }

export function pickArgs(value) {
    if (typeof value === 'string' || (value && typeof value === 'object')) return value
    return undefined
  }

export function pickNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

export function syntheticId(prefix, seq) {
    return `${prefix}#${String(seq)}`
  }

export function blocksOfType(content, type) {
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

export function textFromContent(content) {
    return blocksOfType(content, 'text')
  }

export function reasoningFromContent(content) {
    return blocksOfType(content, 'reasoning')
  }

export function imagesFromContent(content) {
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

export function chunkTarget(data) {
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

export function tsKey(turn, step) {
    return turn === undefined || step === undefined ? undefined : `${turn}.${step}`
  }

export function decodePendingTurnStep(id) {
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

export function replaceMessage(state, oldMessage, next) {
    const index = state.messages.indexOf(oldMessage)
    if (index !== -1) state.messages[index] = next
    state.byId.delete(oldMessage.id)
    state.byId.set(next.id, next)
  }

export function retargetTurnStep(state, key, oldMessage, next) {
    if (key === undefined) return
    if (state.pendingByTurnStep.get(key) === oldMessage) state.pendingByTurnStep.set(key, next)
    if (state.turnStepMessage.get(key) === oldMessage) state.turnStepMessage.set(key, next)
  }

export function usageFromData(data) {
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

export function applyUserMessage(state, event) {
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

export function applyAssistantMessage(state, event) {
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

export function applyChunk(state, event) {
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

export function findByIdOrSeq(state, event) {
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

export function applyUpdate(state, event) {
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

export function removeMessage(state, message) {
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

export function applyDelete(state, event) {
    const message = findByIdOrSeq(state, event)
    if (message === undefined) return
    removeMessage(state, message)
  }

export function applyToolCall(state, event) {
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

export function applyTurnEnd(state, event) {
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
    // 失败且没有任何 assistant 消息（首条回复前就报错，如鉴权/配额失败）时，
    // 桌面端会渲染一条错误回复，手机端此前什么都不显示 —— 用户只看到自己
    // 的消息，以为"回复丢了"。这里补建一条 assistant 错误气泡，让失败原因可见。
    if (failed && targets.length === 0) {
      const err = isRecord(reason.error) ? reason.error : {}
      const code = pickString(err.code) || 'error'
      const detail = pickString(err.message)
      const text = detail
        ? `⚠️ 本轮回复失败（${code}）\n\n${detail}`
        : `⚠️ 本轮回复失败（${code}），未收到模型回复。`
      const id = syntheticId('assistant', event.seq)
      const message = {
        id,
        kind: 'assistant',
        text,
        failed: true,
        seq: event.seq,
        time: event.time,
      }
      state.messages.push(message)
      state.byId.set(id, message)
      if (turn !== undefined) state.messageTurn.set(id, turn)
      return
    }
    for (const message of targets) {
      const wasPending = message.pending === true
      // 失败且有 assistant 消息但文本为空（流式占位、未发出任何内容就报错）
      // 时，把失败原因补进去，避免渲染出一条空气泡。
      let errorText
      if (failed && (message.text === '' || message.text === undefined)) {
        const err = isRecord(reason.error) ? reason.error : {}
        const code = pickString(err.code) || 'error'
        const detail = pickString(err.message)
        errorText = detail
          ? `⚠️ 本轮回复失败（${code}）\n\n${detail}`
          : `⚠️ 本轮回复失败（${code}），未收到模型回复。`
      }
      replaceMessage(state, message, {
        ...message,
        ...(wasPending ? { pending: false } : {}),
        ...(failed ? { failed: true } : {}),
        ...(errorText !== undefined ? { text: errorText } : {}),
        // Preserve each step's own final-event seq; same-turn ordering
        // must not depend on arbitrary ids.
        time: event.time,
      })
    }
  }

export function createState(existing) {
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

export function applyEvent(state, ev) {
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

export function snapshotOf(state) {
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

export class EventFolder {
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

export function foldEvents(events, existing) {
    return new EventFolder(existing).fold(events)
  }

export function toWireEvent(entry) {
    return entry?.event || entry
  }

export function sessionTitle(item) {
    const fromProj = item.projections?.values?.title
    if (typeof fromProj === 'string' && fromProj.trim()) return fromProj.trim()
    if (item.title && !String(item.title).startsWith('session-') && item.title !== item.sessionId) return item.title
    // Blank new chats have a cwd (the workspace path). Don't show that folder
    // name in the header / list — wait for the host title projection.
    if (item.blank) return '新会话'
    if (item.cwd) return basename(item.cwd)
    return '新会话'
  }

export function titleText(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

export function withSessionTitle(item, title) {
    if (item.projections?.values?.title === title && item.title === title) return item
    const values = { ...(item.projections?.values || {}), title }
    const projections = item.projections && typeof item.projections === 'object'
      ? { ...item.projections, values }
      : { values }
    return { ...item, title, projections }
  }

/** Per-session seq watermark for title projections (higher-seq-wins). */
const titleWatermark = new Map()

export function applySessionTitle(sessionId, value, seq) {
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

export function seedSessionTitleFromPage(sessionId, page) {
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
