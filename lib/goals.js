/**
 * Host goal service bindings and RPC handlers.
 */
import { svc, isRecord } from './utils.js'

function getAgentAndGoals(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) {
    throw Object.assign(new Error('缺少 sessionId'), { code: 'bad-request' })
  }
  const agentsSvc = svc(ctx, 'agents')
  const goalsSvc = svc(ctx, 'goals')
  const agent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(sessionId) : undefined
  if (!agent || !goalsSvc) {
    throw Object.assign(new Error('目标服务不可用或会话未找到'), { code: 'unavailable' })
  }
  return { agent, goalsSvc }
}

function resolveRef(goalsSvc, agent, ref) {
  if (isRecord(ref) && typeof ref.id === 'string' && typeof ref.revision === 'number') {
    return { id: ref.id, revision: ref.revision }
  }
  const current = goalsSvc.get(agent)
  if (!current) {
    throw Object.assign(new Error('当前没有可操作的目标'), { code: 'no-current-goal' })
  }
  return { id: current.id, revision: current.revision }
}

export function readHostGoal(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return undefined
  try {
    const agentsSvc = svc(ctx, 'agents')
    const goalsSvc = svc(ctx, 'goals')
    const agent = agentsSvc?.get?.(sessionId)
    if (agent && goalsSvc?.get) {
      const view = goalsSvc.get(agent)
      if (view) {
        return {
          goal: {
            id: view.id,
            revision: view.revision,
            objective: view.objective,
            phase: view.phase,
            blockedReason: view.blockedReason,
            maxGoalRounds: view.maxGoalRounds,
          },
          roundsStarted: view.roundsStarted ?? 0,
          createdAt: view.createdAt,
          updatedAt: view.updatedAt,
        }
      }
      return null
    }
  } catch {}

  try {
    const sessions = svc(ctx, 'sessions')
    const projections = svc(ctx, 'sessionProjections')
    const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
    if (session && typeof projections?.cachedSnapshot === 'function') {
      const g = projections.cachedSnapshot(session)?.values?.goal
      if (isRecord(g) || g === null) return g
    }
  } catch {}

  return undefined
}

export async function handleGoalGet(ctx, payload, rpcId) {
  try {
    const { agent, goalsSvc } = getAgentAndGoals(ctx, payload?.sessionId)
    const view = goalsSvc.get(agent)
    return { type: 'server-response', rpcId, result: { ok: true, value: view || null } }
  } catch (err) {
    return {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: err.code || 'error', message: err.message } },
    }
  }
}

export async function handleGoalEdit(ctx, payload, rpcId) {
  try {
    const { agent, goalsSvc } = getAgentAndGoals(ctx, payload?.sessionId)
    const ref = resolveRef(goalsSvc, agent, payload?.ref)
    const objective = typeof payload?.objective === 'string' ? payload.objective.trim() : ''
    if (!objective) {
      throw Object.assign(new Error('目标内容不能为空'), { code: 'bad-request' })
    }
    const view = goalsSvc.edit(agent, ref, { objective })
    return { type: 'server-response', rpcId, result: { ok: true, value: view } }
  } catch (err) {
    return {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: err.code || 'error', message: err.message } },
    }
  }
}

export async function handleGoalPause(ctx, payload, rpcId) {
  try {
    const { agent, goalsSvc } = getAgentAndGoals(ctx, payload?.sessionId)
    const ref = resolveRef(goalsSvc, agent, payload?.ref)
    const view = goalsSvc.pause(agent, ref)
    return { type: 'server-response', rpcId, result: { ok: true, value: view } }
  } catch (err) {
    return {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: err.code || 'error', message: err.message } },
    }
  }
}

export async function handleGoalResume(ctx, payload, rpcId) {
  try {
    const { agent, goalsSvc } = getAgentAndGoals(ctx, payload?.sessionId)
    const ref = resolveRef(goalsSvc, agent, payload?.ref)
    const view = goalsSvc.resume(agent, ref)
    return { type: 'server-response', rpcId, result: { ok: true, value: view } }
  } catch (err) {
    return {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: err.code || 'error', message: err.message } },
    }
  }
}

export async function handleGoalClear(ctx, payload, rpcId) {
  try {
    const { agent, goalsSvc } = getAgentAndGoals(ctx, payload?.sessionId)
    const ref = resolveRef(goalsSvc, agent, payload?.ref)
    const tombstone = goalsSvc.clear(agent, ref)
    return { type: 'server-response', rpcId, result: { ok: true, value: tombstone } }
  } catch (err) {
    return {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: err.code || 'error', message: err.message } },
    }
  }
}
