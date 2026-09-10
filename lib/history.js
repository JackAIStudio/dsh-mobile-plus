import { SESSION_PAGE } from './constants.js'
import { isRecord, svc } from './utils.js'

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
  for (const { entry, ev, seq } of norm) {
    if (seq < keepFrom) continue
    if (!ev || DROP.has(ev.type)) continue
    if (ev.type === 'assistant/message') {
      const data = isRecord(ev.data) ? ev.data : {}
      const message = isRecord(data.message) ? data.message : data
      const merged = mergeChunkIntoMessage(message, acc.get(`${data.turn ?? 0}.${data.step ?? 0}`))
      events.push({ event: { ...ev, data: isRecord(data.message) ? { ...data, message: merged } : merged } })
      continue
    }
    events.push(entry)
  }
  return { events, hasMore: messageRows.length > maxMessages }
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
