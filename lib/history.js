import { SESSION_PAGE } from './constants.js'
import { isRecord, svc } from './utils.js'
import { readHostGoal } from './goals.js'

function usageOf(ev) {
  if (!ev) return undefined
  const data = isRecord(ev.data) ? ev.data : {}
  if (ev.type === 'assistant/message' && isRecord(data.usage)) return data.usage
  const chunk = isRecord(data.chunk) ? data.chunk : {}
  if (ev.type === 'assistant/chunk' && chunk.type === 'usage' && isRecord(chunk.usage)) return chunk.usage
  return undefined
}

function pressureTokensOf(usage) {
  if (!isRecord(usage) || typeof usage.inputTokens !== 'number' || !Number.isFinite(usage.inputTokens)) return undefined
  return usage.inputTokens + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
}

export function contextPressureOf(events) {
  let pressureTokens
  let contextWindow
  for (const entry of events || []) {
    const ev = entry && (entry.event || entry)
    if (!ev) continue
    if (ev.type === 'request/context') {
      const data = isRecord(ev.data) ? ev.data : {}
      const window = data.contextWindow
      contextWindow = typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : undefined
    }
    const tokens = pressureTokensOf(usageOf(ev))
    if (tokens !== undefined) pressureTokens = tokens
  }
  const out = {}
  if (pressureTokens !== undefined) out.pressureTokens = pressureTokens
  if (contextWindow !== undefined) out.contextWindow = contextWindow
  return Object.keys(out).length ? out : undefined
}

export function mergeContextPressure(fromEvents, fromHost) {
  if (!fromEvents && !fromHost) return undefined
  return { ...(fromEvents || {}), ...(fromHost || {}) }
}

export function readHostContextPressure(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  try {
    const sessions = svc(ctx, 'sessions')
    const projections = svc(ctx, 'sessionProjections')
    const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
    if (!session || typeof projections?.cachedSnapshot !== 'function') return undefined
    const pressure = projections.cachedSnapshot(session)?.values?.contextPressure
    return isRecord(pressure) ? pressure : undefined
  } catch {
    return undefined
  }
}

export function attachContextPressure(page, folded, ctx, sessionId) {
  if (!page) return page
  const pressure = mergeContextPressure(
    folded?.contextPressure,
    readHostContextPressure(ctx, sessionId),
  )
  const hostGoal = readHostGoal(ctx, sessionId)
  if (!pressure && hostGoal === undefined) return page
  const prev = isRecord(page.projections) ? page.projections : {}
  const values = isRecord(prev.values) ? { ...prev.values } : {}
  if (pressure) values.contextPressure = pressure
  if (hostGoal !== undefined) values.goal = hostGoal
  page.projections = { ...prev, values }
  return page
}

function mergeChunkIntoMessage(message, chunked) {
  const content = Array.isArray(message.content) ? message.content.map((b) => b) : []
  const hasText = content.some((b) => b && b.type === 'text')
  const hasReasoning = content.some((b) => b && b.type === 'reasoning')
  if (chunked && chunked.text !== '' && !hasText) content.unshift({ type: 'text', text: chunked.text })
  if (chunked && chunked.reasoning !== '' && !hasReasoning) content.push({ type: 'reasoning', text: chunked.reasoning })
  return { ...message, content }
}

export function foldHistoryForMobile(entries, maxMessages, beforeSeq) {
  let norm = (entries || []).map((entry, idx) => {
    const ev = entry && (entry.event || entry)
    return { entry, ev, seq: typeof ev?.seq === 'number' ? ev.seq : idx }
  }).sort((a, b) => a.seq - b.seq)

  if (typeof beforeSeq === 'number' && Number.isFinite(beforeSeq)) {
    norm = norm.filter((row) => row.seq <= beforeSeq)
  }

  const MESSAGE = new Set(['user/message', 'assistant/message'])
  const messageRows = norm.filter(({ ev }) => ev && MESSAGE.has(ev.type))
  let keepFrom = messageRows.length <= maxMessages
    ? 0
    : messageRows[messageRows.length - maxMessages].seq

  // 若切分点落在某轮任务中，向前延伸到本轮人类提问（user/message），
  // 确保进入会话时用户提问上下文始终可见，不会被密集的工具调用截断。
  if (keepFrom > 0) {
    let lastUserSeq = -1
    for (const { ev, seq } of norm) {
      if (seq <= keepFrom && ev?.type === 'user/message') {
        lastUserSeq = seq
      }
    }
    if (lastUserSeq !== -1) {
      keepFrom = lastUserSeq
    }
  }

  const acc = new Map()
  for (const { ev } of norm) {
    if (!ev || ev.type !== 'assistant/chunk') continue
    const data = isRecord(ev.data) ? ev.data : {}
    const chunk = isRecord(data.chunk) ? data.chunk : {}
    if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') continue
    const key = `${data.turn ?? 0}.${data.step ?? 0}`
    const cur = acc.get(key) || { text: '', reasoning: '' }
    const piece = typeof chunk.text === 'string' ? chunk.text : ''
    if (chunk.type === 'reasoning-delta') cur.reasoning += piece
    else cur.text += piece
    acc.set(key, cur)
  }

  const DROP = new Set(['assistant/chunk', 'request/header', 'web/deepseek-search-llm-request', 'session/title-llm-request'])
  const events = []
  let lastContext
  let keptContext = false
  for (const row of norm) {
    if (row.ev?.type === 'request/context') lastContext = row
  }
  for (const { entry, ev, seq } of norm) {
    if (seq < keepFrom) continue
    if (!ev || DROP.has(ev.type)) continue
    if (ev.type === 'request/context') keptContext = true
    if (ev.type === 'tool/result') {
      const data = isRecord(ev.data) ? ev.data : {}
      const message = isRecord(data.message) ? data.message : {}
      const content = Array.isArray(message.content) ? message.content : []
      let shouldKeep = false
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        if (part.isError === true) shouldKeep = true
        const inner = Array.isArray(part.content) ? part.content : [part]
        for (const item of inner) {
          if (!item || typeof item !== 'object') continue
          if (item.type === 'image') shouldKeep = true
          if (typeof item.text === 'string' && (item.text.startsWith('Error:') || item.text.includes('<path>'))) shouldKeep = true
        }
      }
      if (shouldKeep) {
        events.push(entry)
      }
      continue
    }
    if (ev.type === 'assistant/message') {
      const data = isRecord(ev.data) ? ev.data : {}
      const message = isRecord(data.message) ? data.message : data
      const merged = mergeChunkIntoMessage(message, acc.get(`${data.turn ?? 0}.${data.step ?? 0}`))
      events.push({ event: { ...ev, data: isRecord(data.message) ? { ...data, message: merged } : merged } })
      continue
    }
    events.push(entry)
  }
  // Occupancy needs the latest request/context even when it predates the
  // message-aligned page window. Pin it to the front so the client fold still
  // sees the denominator.
  if (lastContext && !keptContext) events.unshift(lastContext.entry)
  return {
    events,
    hasMore: messageRows.length > maxMessages,
    contextPressure: contextPressureOf(norm.map((row) => row.ev)),
  }
}

export function sessionCursor(row) {
  return `${row.updatedAt}:${row.sessionId}`
}

export function paginateSessions(items, cursor) {
  const start = cursor
    ? Math.max(0, items.findIndex((row) => sessionCursor(row) === cursor) + 1)
    : 0
  const page = items.slice(start, start + SESSION_PAGE)
  const last = page[page.length - 1]
  const nextCursor = last && start + page.length < items.length ? sessionCursor(last) : undefined
  return { items: page, hasMore: Boolean(nextCursor), nextCursor }
}

export function formatWorkspaceView(ws) {
  if (!ws) return ws
  return {
    workspaceId: ws.workspaceId || ws.id,
    path: ws.path,
    title: ws.title,
    sessionIds: Array.isArray(ws.sessionIds) ? [...ws.sessionIds] : [],
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
  }
}

export async function sessionsForWorkspace(ctx, items, workspaceId) {
  if (!workspaceId) return items
  try {
    let wsList = []
    const api = svc(ctx, 'apiProxy')
    const wsCtrl = svc(ctx, 'workspaceController')
    const wsRegistry = svc(ctx, 'workspaceRegistry')
    if (api?.workspace?.list) {
      const listed = await api.workspace.list({ rpcId: `mp-ws-filter-${Date.now()}`, payload: {} })
      if (listed.result?.ok) wsList = listed.result.value.items || []
    } else if (typeof wsCtrl?.feed?.baseline === 'function') {
      wsList = wsCtrl.feed.baseline()?.items || []
    } else if (typeof wsRegistry?.list === 'function') {
      wsList = wsRegistry.list().map(formatWorkspaceView)
    }
    const ws = wsList.find((row) => (row.workspaceId || row.id) === workspaceId)
    const owned = new Set(ws?.sessionIds || [])
    return items.filter((row) => owned.has(row.sessionId))
  } catch {
    return items
  }
}

export async function fetchSessionEvents(ctx, sessionId, signal) {
  if (!sessionId) return { rawEvents: [], projections: {} }
  let rawEvents = []
  let projections = {}

  const sessionsSvc = svc(ctx, 'sessions')
  const live = sessionsSvc?.get?.(sessionId)
  if (live) {
    rawEvents = typeof live.snapshotEvents === 'function'
      ? live.snapshotEvents()
      : (Array.isArray(live.events) ? live.events.slice() : [])
    projections = live.projections?.values || {}
  }

  if (!rawEvents || rawEvents.length === 0) {
    const query = svc(ctx, 'sessionQuery')
    if (query?.observeSession) {
      let obs
      try {
        obs = await query.observeSession(sessionId, { signal, projectionMode: 'all' })
        if (obs?.events) {
          rawEvents = Array.isArray(obs.events) ? obs.events.slice() : []
          if (obs.projections?.values) {
            projections = { ...projections, ...obs.projections.values }
          }
        }
      } catch {
        /* fall through */
      } finally {
        obs?.[Symbol.dispose]?.()
      }
    }
  }

  if (!rawEvents || rawEvents.length === 0) {
    const sessionCtrl = svc(ctx, 'sessionController')
    if (sessionCtrl?.page) {
      try {
        const res = await sessionCtrl.page({
          address: { kind: 'session', sessionId },
          throughSeq: -1,
          maxMessages: 1000,
        }, signal)
        if (res?.records) {
          rawEvents = res.records.map((r) => r.event || r)
        }
      } catch {}
    }
  }

  return { rawEvents, projections }
}
