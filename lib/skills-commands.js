/**
 * Host skills discovery and slash command execution dispatcher.
 */
import { svc } from './utils.js'
import { sessionCwd } from './upload.js'

export async function listSkills(ctx, payload, rpcId, opSignal) {
  const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
  const catalog = svc(ctx, 'sessionSkillCatalog')

  if (sessionId && catalog && typeof catalog.list === 'function') {
    try {
      const res = await catalog.list({ sessionId }, opSignal)
      if (res && Array.isArray(res.skills)) {
        const items = res.skills.map((s) => ({
          name: s.name,
          description: s.description || '',
          whenToUse: s.whenToUse,
          modelInvocable: s.modelInvocable !== false,
        }))
        return { type: 'server-response', rpcId, result: { ok: true, value: { items, skills: items } } }
      }
    } catch {
      // Session observation not available (e.g. blank session), fall back to cwd listing
    }
  }

  const skillsSvc = svc(ctx, 'skills')
  if (skillsSvc && typeof skillsSvc.list === 'function') {
    try {
      let cwd = payload && typeof payload.cwd === 'string' ? payload.cwd : ''
      if (!cwd && sessionId) {
        cwd = await sessionCwd(ctx, sessionId)
      }
      if (!cwd) {
        const wsCtrl = svc(ctx, 'workspaceController')
        const base = wsCtrl?.feed?.baseline?.()
        cwd = base?.items?.[0]?.path || process.cwd()
      }
      const raw = await skillsSvc.list({ cwd, signal: opSignal })
      const list = Array.isArray(raw) ? raw : []
      const items = list
        .filter((s) => s && (!s.invocation || s.invocation.userInvocable !== false))
        .map((s) => ({
          name: s.name,
          description: s.description || '',
          whenToUse: s.whenToUse,
          modelInvocable: s.invocation ? s.invocation.modelInvocable !== false : true,
        }))
      return { type: 'server-response', rpcId, result: { ok: true, value: { items, skills: items } } }
    } catch (err) {
      return { type: 'server-response', rpcId, result: { ok: false, error: { code: 'error', message: String(err?.message || err) } } }
    }
  }

  return { type: 'server-response', rpcId, result: { ok: true, value: { items: [], skills: [] } } }
}

export function listCommands(ctx, payload, rpcId) {
  const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
  const agentsSvc = svc(ctx, 'agents')
  const commandsSvc = svc(ctx, 'commands')
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

export async function executeCommand(ctx, payload, rpcId, opSignal) {
  const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
  const line = payload && typeof payload.line === 'string' ? payload.line : ''
  const agentsSvc = svc(ctx, 'agents')
  const commandsSvc = svc(ctx, 'commands')
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
