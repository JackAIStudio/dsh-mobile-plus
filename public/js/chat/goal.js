/**
 * Goal projections and live mutations.
 */
import { state, chat } from '../state/state.js'
import { call } from '../net/rpc.js'
import { isRecord, toWireEvent } from './fold.js'
import { render } from '../ui/views/render.js'

export const goalWatermark = new Map()

export function normalizeGoal(raw) {
  if (!raw || typeof raw !== 'object') return null
  let snapshot = raw
  let roundsStarted = typeof raw.roundsStarted === 'number' ? raw.roundsStarted : 0

  // Host GoalProjection shape: { goal: GoalSnapshot, roundsStarted: number }
  if (isRecord(raw.goal)) {
    snapshot = raw.goal
    if (typeof raw.roundsStarted === 'number') roundsStarted = raw.roundsStarted
  }

  const id = typeof snapshot.id === 'string' ? snapshot.id : ''
  const revision = typeof snapshot.revision === 'number' ? snapshot.revision : 1
  const objective = typeof snapshot.objective === 'string' ? snapshot.objective.trim() : ''
  const phase = typeof snapshot.phase === 'string' ? snapshot.phase : 'active'
  const maxGoalRounds = typeof snapshot.maxGoalRounds === 'number' ? snapshot.maxGoalRounds : 256
  const blockedReason = isRecord(snapshot.blockedReason) ? snapshot.blockedReason : undefined

  if (!id || !objective || phase === 'complete') return null

  return {
    id,
    revision,
    objective,
    phase,
    blockedReason,
    maxGoalRounds,
    roundsStarted,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
}

export function standingGoal() {
  return chat.goal ?? null
}

export function acceptGoalSeq(sessionId, seq) {
  if (typeof seq !== 'number') return true
  const prev = goalWatermark.get(sessionId)
  if (prev !== undefined && seq < prev) return false
  if (prev === undefined || seq > prev) goalWatermark.set(sessionId, seq)
  return true
}

export function applyGoalProjection(sessionId, value, seq) {
  if (sessionId !== state.session?.sessionId) return false
  if (!acceptGoalSeq(sessionId, seq)) return false
  const next = normalizeGoal(value)
  const prev = chat.goal
  const changed = JSON.stringify(prev) !== JSON.stringify(next)
  chat.goal = next
  return changed
}

export function applyGoalChangeEvent(sessionId, ev) {
  if (!ev || ev.type !== 'goal/change' || sessionId !== state.session?.sessionId) return false
  if (!acceptGoalSeq(sessionId, ev.seq)) return false
  const data = isRecord(ev.data) ? ev.data : {}
  if (data.operation === 'clear') {
    const changed = chat.goal !== null
    chat.goal = null
    return changed
  }
  const next = normalizeGoal(data.goal ? { ...data.goal, roundsStarted: data.roundsStarted } : data)
  const prev = chat.goal
  const changed = JSON.stringify(prev) !== JSON.stringify(next)
  chat.goal = next
  return changed
}

export function seedGoalFromPage(sessionId, page, extraEvents) {
  goalWatermark.delete(sessionId)
  const projected = page?.projections?.values?.goal
  let current = normalizeGoal(projected)

  const events = Array.isArray(extraEvents) ? extraEvents : []
  for (const entry of events) {
    const ev = toWireEvent(entry)
    if (ev && ev.type === 'goal/change') {
      const data = isRecord(ev.data) ? ev.data : {}
      if (data.operation === 'clear') {
        current = null
      } else {
        current = normalizeGoal(data.goal ? { ...data.goal, roundsStarted: data.roundsStarted } : data)
      }
    }
  }

  chat.goal = current
  const asOf = typeof page?.projections?.asOfSeq === 'number' ? page.projections.asOfSeq : undefined
  if (asOf !== undefined) goalWatermark.set(sessionId, asOf)
  return current
}

export async function pauseCurrentGoal() {
  const sid = state.session?.sessionId
  if (!sid || !chat.goal) return
  try {
    const res = await call('goal.pause', { sessionId: sid, ref: { id: chat.goal.id, revision: chat.goal.revision } })
    if (res?.ok && res.value) {
      chat.goal = normalizeGoal(res.value)
      render()
    }
  } catch (err) {
    state.error = String(err.message || err)
    render()
  }
}

export async function resumeCurrentGoal() {
  const sid = state.session?.sessionId
  if (!sid || !chat.goal) return
  try {
    const res = await call('goal.resume', { sessionId: sid, ref: { id: chat.goal.id, revision: chat.goal.revision } })
    if (res?.ok && res.value) {
      chat.goal = normalizeGoal(res.value)
      render()
    }
  } catch (err) {
    state.error = String(err.message || err)
    render()
  }
}

export async function editCurrentGoal(objective) {
  const sid = state.session?.sessionId
  if (!sid || !chat.goal) return false
  try {
    const res = await call('goal.edit', { sessionId: sid, ref: { id: chat.goal.id, revision: chat.goal.revision }, objective })
    if (res?.ok && res.value) {
      chat.goal = normalizeGoal(res.value)
      render()
      return true
    }
    return false
  } catch (err) {
    state.error = String(err.message || err)
    render()
    return false
  }
}

export async function clearCurrentGoal() {
  const sid = state.session?.sessionId
  if (!sid || !chat.goal) return
  try {
    const res = await call('goal.clear', { sessionId: sid, ref: { id: chat.goal.id, revision: chat.goal.revision } })
    if (res?.ok) {
      chat.goal = null
      render()
    }
  } catch (err) {
    state.error = String(err.message || err)
    render()
  }
}
