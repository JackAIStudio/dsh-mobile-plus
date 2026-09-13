/**
 * Session sorting, pin prioritization, and query filtering.
 */
import { state } from '../../state/state.js'
import { isSessionPinned, getPinnedOrder } from '../../net/pins.js'
import { isSessionVisible, findWorkspaceForSession } from './session-list-data.js'
import { sessionTitle } from '../../chat/fold.js'
import { workspaceTitle } from '../../utils/dom.js'

export function sortSessionsWithPins(items, sortMode, workspace) {
  const pinned = []
  const regular = []

  for (const item of items) {
    if (isSessionPinned(item.sessionId)) {
      pinned.push(item)
    } else {
      regular.push(item)
    }
  }

  // 置顶按置顶顺序（新置顶在前）
  pinned.sort((a, b) => {
    const orderA = getPinnedOrder(a.sessionId)
    const orderB = getPinnedOrder(b.sessionId)
    return (orderA === -1 ? 9999 : orderA) - (orderB === -1 ? 9999 : orderB)
  })

  // 未置顶按当前规则排序
  if (sortMode === 'recent') {
    regular.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } else if (sortMode === 'manual' && workspace) {
    const orderMap = new Map((workspace.sessionIds || []).map((id, idx) => [id, idx]))
    regular.sort((a, b) => (orderMap.get(a.sessionId) ?? 9999) - (orderMap.get(b.sessionId) ?? 9999))
  }

  return { pinned, regular, all: [...pinned, ...regular] }
}

export function getSortedSessions() {
  const visible = (state.sessions || []).filter(isSessionVisible)
  return sortSessionsWithPins(visible, state.sortMode, state.workspace).all
}

export function visibleSessionsGrouped() {
  const q = (state.sessionQuery || '').trim().toLowerCase()
  const visible = (state.sessions || []).filter(isSessionVisible)
  const filtered = !q ? visible : visible.filter((s) => {
    const title = (s.blank ? '新会话' : sessionTitle(s)).toLowerCase()
    const ws = findWorkspaceForSession(s.sessionId) || state.workspace
    const wsName = ws ? workspaceTitle(ws).toLowerCase() : ''
    return title.includes(q) || wsName.includes(q)
  })

  return sortSessionsWithPins(filtered, state.sortMode, state.workspace)
}

export function visibleSessions() {
  return visibleSessionsGrouped().all
}
