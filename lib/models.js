import { wrap, svc, isRecord } from './utils.js'

export function asModelSelection(value) {
  if (!isRecord(value)) return undefined
  if (typeof value.provider !== 'string' || value.provider === '') return undefined
  if (typeof value.model !== 'string' || value.model === '') return undefined
  return {
    provider: value.provider,
    model: value.model,
    ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort !== ''
      ? { reasoningEffort: value.reasoningEffort }
      : {}),
  }
}

function projectedSelection(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  try {
    const sessions = svc(ctx, 'sessions')
    const projections = svc(ctx, 'sessionProjections')
    const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
    if (!session || typeof projections?.cachedSnapshot !== 'function') return undefined
    const ms = projections.cachedSnapshot(session)?.values?.modelSelection
    return asModelSelection(ms?.next) || asModelSelection(ms?.lastUsed)
  } catch {
    return undefined
  }
}

function normalizeCatalog(ctx, sessionId, catalog) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : []
  const failures = Array.isArray(catalog?.failures) ? catalog.failures : []
  const current = projectedSelection(ctx, sessionId)
    || asModelSelection(catalog?.current)
    || asModelSelection(catalog?.default)
  return {
    current,
    groups,
    failures,
    ...(Array.isArray(catalog?.routableProviders) ? { routableProviders: catalog.routableProviders } : {}),
  }
}

function fail(rpcId, err) {
  const reason = err?.details?.reason || err?.reason
  const message = reason ? `${err.message || '请求失败'}: ${reason}` : (err?.message || String(err))
  return {
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code: err?.code || 'error', message, details: err?.details } },
  }
}

async function fetchRawCatalog(ctx, payload, rpcId) {
  const api = svc(ctx, 'apiProxy')
  const sessionCtrl = svc(ctx, 'sessionController')
  if (typeof sessionCtrl?.modelCatalog === 'function') {
    return { ok: true, value: await sessionCtrl.modelCatalog() }
  }
  if (api?.sessions?.modelCatalog) {
    const wrapped = await api.sessions.modelCatalog({ rpcId, payload })
    return wrapped?.result || { ok: false, error: { code: 'unavailable', message: '模型目录服务不可用' } }
  }
  if (api?.sessions?.models) {
    const wrapped = await api.sessions.models({ rpcId, payload })
    return wrapped?.result || { ok: false, error: { code: 'unavailable', message: '模型目录服务不可用' } }
  }
  return { ok: false, error: { code: 'unavailable', message: '模型目录服务不可用' } }
}

/**
 * Host catalog is now `session.modelCatalog()` → `{ default, groups, failures }`.
 * Mobile selectors still want `{ current, groups, failures }`.
 */
export async function loadSessionModels(ctx, payload, rpcId) {
  try {
    const raw = await fetchRawCatalog(ctx, payload, rpcId)
    if (!raw?.ok) {
      return wrap(rpcId, { result: raw || { ok: false, error: { code: 'unavailable', message: '模型目录服务不可用' } } })
    }
    const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
    return wrap(rpcId, { result: { ok: true, value: normalizeCatalog(ctx, sessionId, raw.value) } })
  } catch (err) {
    return fail(rpcId, err)
  }
}
