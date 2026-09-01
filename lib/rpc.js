import { SESSION_PAGE, QUOTA_TTL_MS } from './constants.js'
import { isRecord, wrap, fetchLoopbackJson } from './utils.js'
import { listHostDirectory } from './fs-browser.js'
import { persistPhoneImages, slimHistoryImages, sessionCwd } from './upload.js'

let quotaCache = { at: 0, value: null }

export async function readQuotaSnapshot(ctx, force, signal) {
  if (!force && quotaCache.value && Date.now() - quotaCache.at < QUOTA_TTL_MS) {
    return quotaCache.value
  }
  const port = ctx.webServer.port
  const [deepseek, grok] = await Promise.all([
    fetchLoopbackJson(port, '/dsh-deepseek-balance', signal),
    fetchLoopbackJson(port, '/dsh-grok-oauth/usage', signal),
  ])
  const value = { deepseek, grok }
  quotaCache = { at: Date.now(), value }
  return value
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

function sessionCursor(row) {
  return `${row.updatedAt}:${row.sessionId}`
}

function paginateSessions(items, cursor) {
  const start = cursor
    ? Math.max(0, items.findIndex((row) => sessionCursor(row) === cursor) + 1)
    : 0
  const page = items.slice(start, start + SESSION_PAGE)
  const last = page[page.length - 1]
  const nextCursor = last && start + page.length < items.length ? sessionCursor(last) : undefined
  return { items: page, hasMore: Boolean(nextCursor), nextCursor }
}

async function sessionsForWorkspace(ctx, items, workspaceId) {
  if (!workspaceId) return items
  try {
    const listed = await ctx.apiProxy.workspace.list({ rpcId: `mp-ws-filter-${Date.now()}`, payload: {} })
    if (!listed.result?.ok) return items
    const ws = (listed.result.value.items || []).find((row) => row.workspaceId === workspaceId)
    const owned = new Set(ws?.sessionIds || [])
    return items.filter((row) => owned.has(row.sessionId))
  } catch {
    return items
  }
}

export function createDispatcher(ctx, pendingTracker) {
  return async (method, payload, rpcId, signal) => {
    const api = ctx.apiProxy
    if (method === 'workspace.list') return wrap(rpcId, await api.workspace.list({ rpcId, payload }))
    if (method === 'workspace.create') return wrap(rpcId, await api.workspace.create({ rpcId, payload }))
    if (method === 'host.listDirectory') {
      try {
        const viaHost = await api.host.listDirectory({ rpcId, payload }, signal)
        if (viaHost.result?.ok) return wrap(rpcId, viaHost)
        if (viaHost.result?.error?.code !== 'directory-picker-unavailable') return wrap(rpcId, viaHost)
      } catch {
        /* native picker, missing method — fall through to local listing */
      }
      return wrap(rpcId, await listHostDirectory(payload, signal))
    }
    if (method === 'agentPreset.list') return wrap(rpcId, await api.agentPresets.list({ rpcId, payload }))
    if (method === 'session.create') return wrap(rpcId, await api.sessions.create({ rpcId, payload }))
    if (method === 'session.history') {
      const full = await api.sessions.history({ rpcId, payload })
      if (full.result?.ok) {
        const max = Number.isFinite(payload?.maxMessages) ? payload.maxMessages : 30
        const folded = foldHistoryForMobile(full.result.value.events, max)
        const cwd = await sessionCwd(ctx, payload?.sessionId)
        folded.events = await slimHistoryImages(folded.events, cwd)
        full.result.value.events = folded.events
        full.result.value.hasMore = folded.hasMore
      }
      return wrap(rpcId, full)
    }
    if (method === 'session.prompt') {
      const next = await persistPhoneImages(ctx, payload)
      return wrap(rpcId, await api.sessions.prompt({ rpcId, payload: next }))
    }
    if (method === 'session.cancel') return wrap(rpcId, await api.sessions.cancel({ rpcId, payload }))
    if (method === 'session.attachment') return wrap(rpcId, await api.sessions.attachment({ rpcId, payload }))
    if (method === 'session.models') return wrap(rpcId, await api.sessions.models({ rpcId, payload }))
    if (method === 'session.selectModel') return wrap(rpcId, await api.sessions.selectModel({ rpcId, payload }))
    if (method === 'mobile.pending') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      return { type: 'server-response', rpcId, result: { ok: true, value: pendingTracker.pending(sessionId) } }
    }
    if (method === 'mobile.respond') {
      if (typeof api.respond !== 'function') {
        return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'unavailable', message: 'respond 不可用' } } }
      }
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const kind = payload && payload.type
      let targetRpcId = typeof payload?.rpcId === 'string' ? payload.rpcId : ''
      let value
      if (kind === 'approval') {
        const approvalId = payload.approvalId
        const found = pendingTracker.findApproval(sessionId, approvalId)
        if (found?.rpcId) targetRpcId = found.rpcId
        value = { sessionId, approvalId, outcome: payload.outcome }
      } else if (kind === 'question') {
        const found = pendingTracker.findQuestion(sessionId, targetRpcId)
        if (!found && targetRpcId === '' && pendingTracker.pending(sessionId).questions[0]) {
          targetRpcId = pendingTracker.pending(sessionId).questions[0].rpcId
        }
        value = { sessionId, answer: { answers: Array.isArray(payload.answers) ? payload.answers : [] } }
      } else {
        return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'bad-request', message: 'unknown respond type' } } }
      }
      if (!targetRpcId) {
        return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'not-pending', message: '没有待处理的审批或提问' } } }
      }
      const receipt = await api.respond({
        type: 'client-response',
        rpcId: targetRpcId,
        result: { ok: true, value },
      })
      return wrap(rpcId, { result: { ok: true, value: receipt } })
    }
    if (method === 'skill.list') return wrap(rpcId, await api.skills.list({ rpcId, payload }))
    if (method === 'command.list') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const agent = sessionId && ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(sessionId) : undefined
      if (!agent || !ctx.commands || typeof ctx.commands.list !== 'function') {
        return { type: 'server-response', rpcId, result: { ok: true, value: { items: [] } } }
      }
      const items = ctx.commands.list(agent).map((row) => ({
        name: row.name,
        description: row.description,
        hint: row.input && typeof row.input.hint === 'string' ? row.input.hint : undefined,
      }))
      return { type: 'server-response', rpcId, result: { ok: true, value: { items } } }
    }
    if (method === 'command.execute') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const line = payload && typeof payload.line === 'string' ? payload.line : ''
      const agent = sessionId && ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(sessionId) : undefined
      if (!agent || !ctx.commands || typeof ctx.commands.execute !== 'function') {
        return {
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'unavailable', message: '宿主命令服务不可用' } },
        }
      }
      const execution = await ctx.commands.execute(agent, line, [], signal)
      if (execution === undefined) {
        return {
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'unknown-command', message: '未知命令' } },
        }
      }
      return { type: 'server-response', rpcId, result: { ok: true, value: { matched: true, result: execution.result } } }
    }
    if (method === 'quota.read') {
      const force = payload && payload.force === true
      const value = await readQuotaSnapshot(ctx, force, signal)
      return { type: 'server-response', rpcId, result: { ok: true, value } }
    }
    if (method === 'host.restart') {
      try {
        const port = ctx.webServer.port
        const res = await fetch(`http://127.0.0.1:${port}/dsh-web-restart`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
          signal,
        })
        const value = await res.json()
        return { type: 'server-response', rpcId, result: { ok: res.ok, value } }
      } catch (err) {
        return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'restart-failed', message: err instanceof Error ? err.message : String(err) } } }
      }
    }
    if (method === 'session.list') {
      const full = await api.sessions.list({ rpcId, payload })
      if (!full.result.ok) return wrap(rpcId, full)
      const workspaceId = payload && typeof payload.workspaceId === 'string' ? payload.workspaceId : ''
      const sorted = [...full.result.value.items].sort((a, b) => b.updatedAt - a.updatedAt)
      const items = await sessionsForWorkspace(ctx, sorted, workspaceId)
      const cursor = payload && typeof payload.cursor === 'string' ? payload.cursor : undefined
      const page = paginateSessions(items, cursor)
      return {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: page },
      }
    }
    throw new Error(`unhandled ${method}`)
  }
}
