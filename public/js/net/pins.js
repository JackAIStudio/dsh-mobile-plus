/**
 * Session pinning state synchronization, toggling, and mention formatting.
 */
import { state } from '../state/state.js'
import { call } from './rpc.js'
import { showToast } from '../utils/toast.js'
import { render } from '../ui/views/render.js'

let syncInitialized = false
let pinsHeartbeatTimer = null
let pinsBroadcastChannel = null

function bytesToBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function encodeSessionReferenceUri(sessionId) {
  const bytes = new TextEncoder().encode(JSON.stringify(sessionId))
  return `dsh-session:${bytesToBase64Url(bytes)}`
}

export function formatSessionReferenceMention(sessionId, title) {
  const label = String(title || sessionId || '').replace(/[\\\]]/g, '\\$&')
  return `@[${label}](${encodeSessionReferenceUri(sessionId)})`
}

export function applyPinsDocument(doc) {
  const list = Array.isArray(doc?.pins) ? doc.pins : []
  const oldIds = Array.from(state.pinnedIds || []).join(',')
  const newPins = []
  const newIds = new Set()

  for (const item of list) {
    const id = typeof item?.sessionId === 'string' ? item.sessionId.trim().toLowerCase() : ''
    if (!id || newIds.has(id)) continue
    newIds.add(id)
    newPins.push({
      sessionId: id,
      pinnedAt: Number(item.pinnedAt) || 0,
    })
  }

  state.pins = newPins
  state.pinnedIds = newIds
  const changed = Array.from(newIds).join(',') !== oldIds
  return changed
}

export function isSessionPinned(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false
  return state.pinnedIds ? state.pinnedIds.has(sessionId.trim().toLowerCase()) : false
}

export function getPinnedOrder(sessionId) {
  if (!sessionId || !isSessionPinned(sessionId)) return -1
  const id = sessionId.trim().toLowerCase()
  return (state.pins || []).findIndex((p) => p.sessionId === id)
}

export async function fetchPins() {
  try {
    const doc = await call('session.pins', {})
    if (doc) {
      const changed = applyPinsDocument(doc)
      if (changed && (state.view === 'sessions' || state.view === 'chat')) {
        render()
      }
      return true
    }
  } catch (err) {
    console.warn('[pins] fetchPins failed:', err)
  }
  return false
}

function broadcastPinsChange(document) {
  try {
    if (!pinsBroadcastChannel && typeof BroadcastChannel !== 'undefined') {
      pinsBroadcastChannel = new BroadcastChannel('dsh-pins-sync')
    }
    pinsBroadcastChannel?.postMessage({ type: 'pins-updated', document })
  } catch {}
}

export function setupPinsSync() {
  if (syncInitialized || typeof window === 'undefined') return
  syncInitialized = true

  // 跨标签页即时同步
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      pinsBroadcastChannel = new BroadcastChannel('dsh-pins-sync')
      pinsBroadcastChannel.onmessage = (ev) => {
        if (ev?.data?.type === 'pins-updated' && ev.data.document) {
          const changed = applyPinsDocument(ev.data.document)
          if (changed && (state.view === 'sessions' || state.view === 'chat')) render()
        }
      }
    }
  } catch {}

  // 切回前台或获得焦点时即时同步
  const onFocusOrVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
      void fetchPins()
    }
  }
  window.addEventListener('focus', onFocusOrVisible)
  document.addEventListener('visibilitychange', onFocusOrVisible)

  // 前台静默低频心跳（仅在用户处于活动会话列表或聊天时以 3.5s 周期探活）
  if (pinsHeartbeatTimer === null) {
    pinsHeartbeatTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (state.view !== 'sessions' && state.view !== 'chat') return
      void fetchPins()
    }, 3500)
  }
}

export async function toggleSessionPin(sessionId, targetPinned) {
  if (!sessionId || typeof sessionId !== 'string') return false
  const id = sessionId.trim().toLowerCase()
  const willPin = targetPinned !== undefined ? Boolean(targetPinned) : !isSessionPinned(id)

  const prevPins = [...(state.pins || [])]
  const prevIds = new Set(state.pinnedIds || [])

  // 乐观更新
  const nextPins = prevPins.filter((p) => p.sessionId !== id)
  if (willPin) {
    nextPins.unshift({ sessionId: id, pinnedAt: Date.now() })
  }
  state.pins = nextPins
  state.pinnedIds = new Set(nextPins.map((p) => p.sessionId))
  try { navigator.vibrate?.(15) } catch {}
  render()

  try {
    const res = await call('session.pin', { sessionId: id, pinned: willPin })
    const doc = res?.document || (res?.pins ? res : null)
    if (doc) {
      applyPinsDocument(doc)
      broadcastPinsChange(doc)
    }
    showToast(willPin ? '已置顶会话 📌' : '已取消置顶')
    render()
    return true
  } catch (err) {
    state.pins = prevPins
    state.pinnedIds = prevIds
    showToast('操作失败，请重试')
    render()
    return false
  }
}
