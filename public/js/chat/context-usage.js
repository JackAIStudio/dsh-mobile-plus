/**
 * Session context occupancy: token-meter's contextPressure projection,
 * with a last-wins fold over request/context + provider usage samples.
 */
import { state, chat } from '../state/state.js'
import { isRecord, pickNumber, toWireEvent, usageFromData } from './fold.js'

export const pressureWatermark = new Map()

function usageOf(event) {
  if (!event || typeof event.type !== 'string') return undefined
  const data = isRecord(event.data) ? event.data : {}
  if (event.type === 'assistant/message') return usageFromData(data)
  if (event.type !== 'assistant/chunk' && event.type !== 'message/chunk') return undefined
  const chunk = isRecord(data.chunk) ? data.chunk : {}
  if (chunk.type !== 'usage') return undefined
  return usageFromData(chunk)
}

export function pressureTokensOf(usage) {
  if (!isRecord(usage)) return undefined
  const input = pickNumber(usage.inputTokens)
  if (input === undefined) return undefined
  return input + (pickNumber(usage.cacheReadTokens) || 0) + (pickNumber(usage.cacheWriteTokens) || 0)
}

export function normalizePressure(value) {
  if (!isRecord(value)) return undefined
  const out = {}
  const pressureTokens = pickNumber(value.pressureTokens)
  const projectedTokens = pickNumber(value.projectedTokens)
  const contextWindow = pickNumber(value.contextWindow)
  if (pressureTokens !== undefined) out.pressureTokens = pressureTokens
  if (projectedTokens !== undefined) out.projectedTokens = projectedTokens
  if (contextWindow !== undefined && contextWindow > 0) out.contextWindow = contextWindow
  return Object.keys(out).length ? out : undefined
}

export function occupancyPercent(pressure) {
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const windowSize = pressure?.contextWindow
  if (used === undefined || !windowSize || windowSize <= 0) return undefined
  return Math.min(100, Math.round(used / windowSize * 100))
}

function pressureKey(value) {
  const pressure = normalizePressure(value)
  if (!pressure) return ''
  return `${pressure.pressureTokens ?? ''}:${pressure.projectedTokens ?? ''}:${pressure.contextWindow ?? ''}`
}

export function contextPressureFromEvents(events) {
  let next
  if (!Array.isArray(events)) return undefined
  for (const entry of events) {
    const event = toWireEvent(entry)
    const absorbed = absorbPressure(next, event)
    if (absorbed) next = absorbed
  }
  return next
}

function absorbPressure(current, event) {
  if (!event) return undefined
  let next = current
  if (event.type === 'request/context') {
    const data = isRecord(event.data) ? event.data : {}
    const windowSize = pickNumber(data.contextWindow)
    if (windowSize !== undefined && windowSize > 0 && next?.contextWindow !== windowSize) {
      next = { ...(next || {}), contextWindow: windowSize }
    }
  }
  const tokens = pressureTokensOf(usageOf(event))
  if (tokens !== undefined && next?.pressureTokens !== tokens) {
    next = { ...(next || {}), pressureTokens: tokens }
  }
  return next
}

export function resetContextPressure(sessionId) {
  if (sessionId) pressureWatermark.delete(sessionId)
  chat.contextPressure = undefined
}

export function applyContextPressure(sessionId, value, seq) {
  if (sessionId !== state.session?.sessionId) return false
  if (typeof seq === 'number') {
    const prev = pressureWatermark.get(sessionId)
    if (prev !== undefined && seq < prev) return false
    if (prev === undefined || seq > prev) pressureWatermark.set(sessionId, seq)
  }
  const incoming = normalizePressure(value)
  if (!incoming) return false
  const merged = { ...(chat.contextPressure || {}), ...incoming }
  if (pressureKey(merged) === pressureKey(chat.contextPressure)) return false
  chat.contextPressure = merged
  return true
}

export function absorbContextEvent(event) {
  const next = absorbPressure(chat.contextPressure, event)
  if (!next || pressureKey(next) === pressureKey(chat.contextPressure)) return false
  chat.contextPressure = next
  return true
}

export function seedContextPressureFromPage(sessionId, page, extraEvents) {
  const projected = normalizePressure(page?.projections?.values?.contextPressure)
  const asOf = typeof page?.projections?.asOfSeq === 'number' ? page.projections.asOfSeq : undefined
  let next = projected || contextPressureFromEvents(page?.events)
  if (Array.isArray(extraEvents)) {
    for (const entry of extraEvents) {
      const event = toWireEvent(entry)
      if (typeof asOf === 'number' && typeof event?.seq === 'number' && event.seq <= asOf) continue
      const absorbed = absorbPressure(next, event)
      if (absorbed) next = absorbed
    }
  }
  chat.contextPressure = next
  let floor = asOf
  if (Array.isArray(extraEvents)) {
    for (const entry of extraEvents) {
      const event = toWireEvent(entry)
      if (typeof event?.seq === 'number' && (floor === undefined || event.seq > floor)) floor = event.seq
    }
  }
  if (typeof floor === 'number') {
    const prev = pressureWatermark.get(sessionId)
    if (prev === undefined || floor > prev) pressureWatermark.set(sessionId, floor)
  }
}

export function contextUsage() {
  const fromProjection = occupancyPercent(chat.contextPressure)
  if (fromProjection !== undefined) return fromProjection
  const fallbackWindow = chat.contextPressure?.contextWindow
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    const message = chat.messages[i]
    if (message.kind !== 'assistant' || !message.usage) continue
    const windowSize = message.contextWindow || fallbackWindow
    if (!windowSize || windowSize <= 0) continue
    const tokens = pressureTokensOf(message.usage)
    if (tokens === undefined) continue
    return Math.min(100, Math.round(tokens / windowSize * 100))
  }
  return undefined
}
