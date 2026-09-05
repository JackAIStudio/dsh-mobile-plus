/**
 * Session creation actions: current workspace, arbitrary workspace, and today's workspace.
 */
import { state } from '../../state/state.js'
import { call, timedFetch } from '../../net/rpc.js'
import { el, workspaceTitle } from '../../utils/dom.js'
import { getTodayDateString } from '../../utils/time.js'
import { render } from './render.js'
import { openChat } from './chat-view.js'
import { loadWorkspaces } from './ws-view.js'

export async function createSessionInWorkspace(ws) {
  if (state.creating || !ws) return
  state.creating = true
  state.creatingWorkspaceId = ws.workspaceId
  state.workspace = ws
  state.createError = ''
  render()
  try {
    const created = await call('session.create', {
      workspaceId: ws.workspaceId,
      ...(state.presetId ? { agentPreset: state.presetId } : {}),
    })
    if (!created || !created.sessionId) {
      throw new Error('创建失败：宿主没有返回会话 ID。')
    }
    const ids = Array.isArray(ws.sessionIds) ? ws.sessionIds : []
    if (!ids.includes(created.sessionId)) {
      ws.sessionIds = [created.sessionId].concat(ids)
    }
    await openChat({ sessionId: created.sessionId, title: '新会话' })
  } catch (err) {
    state.createError = String(err.message || err)
  } finally {
    state.creating = false
    state.creatingWorkspaceId = ''
    render()
  }
}

export async function createSession() {
  if (state.creating) return
  if (!state.workspace) {
    state.createError = '没有选中工作区。'
    if (state.view === 'sessions') render()
    return
  }
  await createSessionInWorkspace(state.workspace)
}

export async function createTodaySession() {
  if (state.creating) return
  const todayStr = getTodayDateString()
  const todayMatch = (state.workspaces || []).find((w) => workspaceTitle(w) === todayStr || (w.path && w.path.endsWith(todayStr)))
  if (todayMatch) {
    await createSessionInWorkspace(todayMatch)
    return
  }
  state.creating = true
  state.creatingWorkspaceId = 'today'
  state.createError = ''
  render()
  try {
    const res = await timedFetch('/dsh-today/open', { method: 'POST', credentials: 'same-origin' }, 20 * 1000)
    const data = await res.json()
    if (!res.ok || !data || typeof data.path !== 'string') {
      throw new Error((data && data.error) || '无法创建今天的工作区')
    }
    const result = await call('workspace.create', { path: data.path })
    await loadWorkspaces()
    const freshToday = (state.workspaces || []).find((w) => w.workspaceId === result.workspace.workspaceId) || result.workspace
    await createSessionInWorkspace(freshToday)
  } catch (err) {
    state.createError = String(err.message || err)
    state.creating = false
    state.creatingWorkspaceId = ''
    render()
  }
}

export function renderPresetSelector(onUpdate) {
  if (!state.presets || state.presets.length === 0) return []
  const presetEntry = state.presets.find((p) => p.id === state.presetId)
  return [
    el('label', { class: 'mobile-preset' }, [
      el('span', { class: 'mobile-presetLabel' }, ['Agent 模式']),
      el('select', {
        class: 'mobile-presetSelect',
        value: state.presetId,
        onchange: (ev) => {
          state.presetId = ev.target.value
          if (typeof onUpdate === 'function') onUpdate()
        },
      }, state.presets.map((p) => el('option', { value: p.id }, [p.name || p.id, p.isDefault ? '（默认）' : '']))),
    ]),
    presetEntry?.description ? el('p', { class: 'mobile-presetDescription' }, [presetEntry.description]) : null,
  ].filter(Boolean)
}
