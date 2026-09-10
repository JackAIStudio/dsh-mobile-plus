import { wrap, svc } from './utils.js'
import { listHostDirectory } from './fs-browser.js'
import { persistPhoneImages, slimHistoryImages, sessionCwd } from './upload.js'
import { readQuotaSnapshot } from './quota-service.js'
import { foldHistoryForMobile, paginateSessions, formatWorkspaceView, sessionsForWorkspace } from './history.js'
import { loadSessionModels } from './models.js'

export { readQuotaSnapshot, foldHistoryForMobile }

async function safeCall(fn, rpcId, notFoundMessage) {
  if (typeof fn !== 'function') {
    return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'unavailable', message: notFoundMessage } } }
  }
  try {
    const val = await fn()
    return { type: 'server-response', rpcId, result: { ok: true, value: val } }
  } catch (err) {
    const reason = err.details?.reason || err.reason
    const message = reason ? `${err.message || '请求失败'}: ${reason}` : (err.message || String(err))
    return { type: 'server-response', rpcId, result: { ok: false, error: { code: err.code || 'error', message, details: err.details } } }
  }
}

export function createDispatcher(ctx, pendingTracker) {
  return async (method, payload, rpcId, signal) => {
    const opSignal = signal instanceof AbortSignal ? signal : new AbortController().signal
    const api = svc(ctx, 'apiProxy')
    const sessionCtrl = svc(ctx, 'sessionController')
    const wsCtrl = svc(ctx, 'workspaceController')
    const wsRegistry = svc(ctx, 'workspaceRegistry')
    const presetsSvc = svc(ctx, 'agentPresets')
    const skillsSvc = svc(ctx, 'skills')
    const commandsSvc = svc(ctx, 'commands')
    const agentsSvc = svc(ctx, 'agents')

    if (method === 'workspace.list') {
      if (api?.workspace?.list) return wrap(rpcId, await api.workspace.list({ rpcId, payload }))
      if (typeof wsCtrl?.feed?.baseline === 'function') {
        const base = wsCtrl.feed.baseline() || {}
        return {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { items: base.items || [], archivedSessionIds: base.archivedSessionIds || [] } },
        }
      }
      if (typeof wsRegistry?.list === 'function') {
        const items = wsRegistry.list().map(formatWorkspaceView)
        const archivedSessionIds = [...(wsRegistry.archivedSessionIds || [])]
        return { type: 'server-response', rpcId, result: { ok: true, value: { items, archivedSessionIds } } }
      }
      return { type: 'server-response', rpcId, result: { ok: true, value: { items: [], archivedSessionIds: [] } } }
    }

    if (method === 'workspace.create') {
      if (api?.workspace?.create) return wrap(rpcId, await api.workspace.create({ rpcId, payload }))
      return safeCall(async () => {
        if (wsCtrl?.create) return wsCtrl.create(payload)
        if (wsRegistry?.create) {
          const entity = await wsRegistry.create(payload.path)
          return { workspace: formatWorkspaceView(entity), created: true }
        }
        throw Object.assign(new Error('工作区服务不可用'), { code: 'unavailable' })
      }, rpcId, '工作区服务不可用')
    }

    if (method === 'host.listDirectory') {
      if (api?.host?.listDirectory) {
        try {
          const viaHost = await api.host.listDirectory({ rpcId, payload }, opSignal)
          if (viaHost.result?.ok) return wrap(rpcId, viaHost)
          if (viaHost.result?.error?.code !== 'directory-picker-unavailable') return wrap(rpcId, viaHost)
        } catch {}
      }
      return wrap(rpcId, await listHostDirectory(payload, opSignal))
    }

    if (method === 'agentPreset.list') {
      if (api?.agentPresets?.list) return wrap(rpcId, await api.agentPresets.list({ rpcId, payload }))
      const items = presetsSvc?.list?.() || []
      return { type: 'server-response', rpcId, result: { ok: true, value: { items } } }
    }

    if (method === 'session.create') {
      if (api?.sessions?.create) return wrap(rpcId, await api.sessions.create({ rpcId, payload }))
      return safeCall(() => sessionCtrl?.create?.(payload), rpcId, '创建会话服务不可用')
    }

    if (method === 'session.history') {
      let full
      if (api?.sessions?.history) {
        full = await api.sessions.history({ rpcId, payload })
      } else {
        try {
          const persistence = svc(ctx, 'sessionPersistence')
          if (persistence?.inspect) {
            const inspected = await persistence.inspect(payload?.sessionId, opSignal)
            full = { result: { ok: true, value: { events: inspected?.events || [], hasMore: false } } }
          } else {
            full = { result: { ok: true, value: { events: [], hasMore: false } } }
          }
        } catch (err) {
          full = { result: { ok: false, error: { code: err.code || 'error', message: err.message } } }
        }
      }
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
      if (api?.sessions?.prompt) return wrap(rpcId, await api.sessions.prompt({ rpcId, payload: next }))
      const requestPayload = {
        requestId: typeof next?.requestId === 'string' && next.requestId ? next.requestId : (rpcId || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
        clientTimeZone: typeof next?.clientTimeZone === 'string' ? next.clientTimeZone : Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...next,
      }
      return safeCall(() => sessionCtrl?.prompt?.(requestPayload, opSignal), rpcId, '会话提示服务不可用')
    }

    if (method === 'session.cancel') {
      if (api?.sessions?.cancel) return wrap(rpcId, await api.sessions.cancel({ rpcId, payload }))
      return safeCall(() => sessionCtrl?.cancel?.(payload), rpcId, '取消会话服务不可用')
    }

    if (method === 'session.attachment') {
      if (api?.sessions?.attachment) return wrap(rpcId, await api.sessions.attachment({ rpcId, payload }))
      return safeCall(() => sessionCtrl?.attachment?.(payload), rpcId, '附件读取服务不可用')
    }

    if (method === 'session.models') {
      return loadSessionModels(ctx, payload, rpcId)
    }

    if (method === 'session.selectModel') {
      if (api?.sessions?.selectModel) return wrap(rpcId, await api.sessions.selectModel({ rpcId, payload }))
      return safeCall(() => sessionCtrl?.selectModel?.(payload), rpcId, '模型切换服务不可用')
    }

    if (method === 'mobile.pending') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      return { type: 'server-response', rpcId, result: { ok: true, value: pendingTracker.pending(sessionId) } }
    }

    if (method === 'mobile.respond') {
      if (typeof api?.respond !== 'function') {
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

    if (method === 'skill.list') {
      if (api?.skills?.list) return wrap(rpcId, await api.skills.list({ rpcId, payload }))
      const items = skillsSvc?.list?.() || []
      return { type: 'server-response', rpcId, result: { ok: true, value: { items } } }
    }

    if (method === 'command.list') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const agent = sessionId && agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(sessionId) : undefined
      if (!agent || !commandsSvc || typeof commandsSvc.list !== 'function') {
        return { type: 'server-response', rpcId, result: { ok: true, value: { items: [] } } }
      }
      const items = commandsSvc.list(agent).map((row) => ({
        name: row.name,
        description: row.description,
        hint: row.input && typeof row.input.hint === 'string' ? row.input.hint : undefined,
      }))
      return { type: 'server-response', rpcId, result: { ok: true, value: { items } } }
    }

    if (method === 'command.execute') {
      const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
      const line = payload && typeof payload.line === 'string' ? payload.line : ''
      const agent = sessionId && agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(sessionId) : undefined
      if (!agent || !commandsSvc || typeof commandsSvc.execute !== 'function') {
        return {
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'unavailable', message: '宿主命令服务不可用' } },
        }
      }
      const execution = await commandsSvc.execute(agent, line, [], opSignal)
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
      const value = await readQuotaSnapshot(ctx, force, opSignal)
      return { type: 'server-response', rpcId, result: { ok: true, value } }
    }

    if (method === 'host.restart') {
      try {
        const port = ctx.webServer.port
        const res = await fetch(`http://127.0.0.1:${port}/dsh-web-restart`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
          signal: opSignal,
        })
        const value = await res.json()
        return { type: 'server-response', rpcId, result: { ok: res.ok, value } }
      } catch (err) {
        return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'restart-failed', message: err instanceof Error ? err.message : String(err) } } }
      }
    }

    if (method === 'session.list') {
      let rawItems = []
      if (api?.sessions?.list) {
        const full = await api.sessions.list({ rpcId, payload })
        if (!full.result.ok) return wrap(rpcId, full)
        rawItems = full.result.value.items || []
      } else if (sessionCtrl?.list) {
        try {
          const val = await sessionCtrl.list(payload || {}, opSignal)
          rawItems = val?.items || []
        } catch (err) {
          return { type: 'server-response', rpcId, result: { ok: false, error: { code: err.code || 'error', message: err.message } } }
        }
      }
      const workspaceId = payload && typeof payload.workspaceId === 'string' ? payload.workspaceId : ''
      const sorted = [...rawItems].sort((a, b) => b.updatedAt - a.updatedAt)
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
