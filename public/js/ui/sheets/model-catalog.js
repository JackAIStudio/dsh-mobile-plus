/**
 * Shared helpers for the host model catalog payload.
 * Host `session.modelCatalog` returns `{ default, groups }`; older
 * `session.models` returned `{ current, groups }`. Accept both.
 */
import { chat } from '../../state/state.js'

export function catalogGroups(data) {
  return Array.isArray(data?.groups) ? data.groups : []
}

export function catalogFailures(data) {
  return Array.isArray(data?.failures) ? data.failures : []
}

export function catalogSelection(data) {
  const raw = data?.current || data?.default
  if (!raw || typeof raw !== 'object') return undefined
  if (typeof raw.provider !== 'string' || typeof raw.model !== 'string') return undefined
  return raw
}

export function selectedModel(data) {
  return chat.currentModel || catalogSelection(data)
}

export function modelDisplayName(selection, data) {
  if (!selection?.model) return ''
  for (const group of catalogGroups(data)) {
    const models = Array.isArray(group?.models) ? group.models : []
    const hit = models.find((model) => group.id === selection.provider && model.id === selection.model)
    if (hit?.name) return hit.name
  }
  return selection.model
}

export function rememberCatalog(data) {
  if (data && typeof data === 'object') {
    chat.modelCatalog = data
    if (chat.modelSheet?.status === 'loading') chat.modelSheet = { status: 'ready', data }
  }
  const selection = selectedModel(data)
  if (selection) chat.currentModel = selection
}

export function currentModelLabel() {
  const data = chat.modelCatalog || (chat.modelSheet?.status === 'ready' ? chat.modelSheet.data : undefined)
  const selection = selectedModel(data)
  return modelDisplayName(selection, data) || '选择模型'
}
