import { SESSION_PAGE } from './constants.js'
import { isRecord, svc } from './utils.js'

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
  if (!pressure) return page
  const prev = isRecord(page.projections) ? page.projections : {}
  const values = isRecord(prev.values) ? prev.values : {}
  page.projections = { ...prev, values: { ...values, contextPressure: pressure } }
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

export function foldHistoryForMobile(entries, maxMessages) {
  const norm = (entries || []).map((entry, idx) => {
    const ev = entry && (entry.event || entry)
    return { entry, ev, seq: typeof ev?.seq === 'number' ? ev.seq : idx }
  }).sort((a, b) => a.seq - b.seq)

  const MESSAGE = new Set(['user/message', 'assistant/message'])
  const messageRows = norm.filter(({ ev }) => ev && MESSAGE.has(ev.type))
  const keepFrom = messageRows.length <= maxMessages
    ? 0
    : messageRows[messageRows.length - maxMessages].seq

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

  const DROP = new Set(['assistant/chunk', 'request/header', 'tool/result', 'web/deepseek-search-llm-request', 'session/title-llm-request'])
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
