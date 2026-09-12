/**
 * Workspace filtering, classification and partitioning utilities.
 * Separates regular project workspaces from day-based daily workspaces.
 */
import { workspaceTitle } from './dom.js'

/**
 * Checks if a workspace is a day-based daily workspace (e.g. 2026-09-12, days/2026-09-12).
 * @param {object} ws
 * @returns {boolean}
 */
export function isDailyWorkspace(ws) {
  if (!ws) return false
  const title = typeof ws.title === 'string' ? ws.title.trim() : ''
  if (/^\d{4}[-_.]\d{2}[-_.]\d{2}$/.test(title) || /^\d{8}$/.test(title)) return true
  const path = typeof ws.path === 'string' ? ws.path.trim() : ''
  if (!path) return false
  const cleanPath = path.replace(/[/\\]+$/, '')
  if (/(?:^|[\\/])days[\\/]\d{4}[-_.]\d{2}[-_.]\d{2}$/.test(cleanPath)) return true
  if (/(?:^|[\\/])days[\\/]\d{8}$/.test(cleanPath)) return true
  const endSegment = cleanPath.split(/[/\\]/).pop() || ''
  if (/^\d{4}[-_.]\d{2}[-_.]\d{2}$/.test(endSegment) || /^\d{8}$/.test(endSegment)) return true
  return false
}

/**
 * Partitions workspaces into regular project workspaces and daily workspaces.
 * @param {Array<object>} workspaces
 * @returns {{ projects: Array<object>, daily: Array<object> }}
 */
export function partitionWorkspaces(workspaces) {
  const projects = []
  const daily = []
  for (const ws of workspaces || []) {
    if (isDailyWorkspace(ws)) {
      daily.push(ws)
    } else {
      projects.push(ws)
    }
  }
  return { projects, daily }
}

/**
 * Sorts daily workspaces in descending date order (newest first).
 * @param {Array<object>} dailyList
 * @returns {Array<object>}
 */
export function sortDailyWorkspaces(dailyList) {
  return dailyList.slice().sort((a, b) => {
    const keyA = (a.title || a.path || '').toLowerCase()
    const keyB = (b.title || b.path || '').toLowerCase()
    return keyB.localeCompare(keyA)
  })
}

/**
 * Sorts workspaces according to user sort mode (e.g. recent active session time).
 * @param {Array<object>} list
 * @param {string} sortMode
 * @param {object} runtime
 * @returns {Array<object>}
 */
export function sortWorkspaces(list, sortMode, runtime) {
  const cloned = list.slice()
  if (sortMode === 'recent') {
    cloned.sort((a, b) => {
      const sessionTimesA = (a.sessionIds || []).map((id) => runtime?.sessionLive?.get(id)?.updatedAt || 0)
      const sessionTimesB = (b.sessionIds || []).map((id) => runtime?.sessionLive?.get(id)?.updatedAt || 0)
      const maxA = sessionTimesA.length ? Math.max(...sessionTimesA) : (a.updatedAt || 0)
      const maxB = sessionTimesB.length ? Math.max(...sessionTimesB) : (b.updatedAt || 0)
      return maxB - maxA
    })
  }
  return cloned
}

/**
 * Filters a workspace list by text query matching title or path.
 * @param {Array<object>} workspaces
 * @param {string} query
 * @returns {Array<object>}
 */
export function filterWorkspaces(workspaces, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return workspaces || []
  return (workspaces || []).filter((ws) => {
    const name = workspaceTitle(ws).toLowerCase()
    const path = (ws.path || '').toLowerCase()
    return name.includes(q) || path.includes(q)
  })
}
