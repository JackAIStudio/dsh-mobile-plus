/**
 * Dedicated Sheet Portal and top-level overlay manager.
 * Isolates bottom sheets from main view re-renders to preserve scroll, state, and focus.
 */
import { state, runtime } from '../../state/state.js'
import { settingsSheet } from './settings-sheet.js'
import { renderModelSheet } from './model-sheet.js'
import { pwaSheet, powerSheet } from './system-sheets.js'
import { quotaSheet } from '../../net/quota-sheet.js'

export function getSheetPortal() {
  if (runtime.sheetPortalNode && typeof document !== 'undefined' && document.body && document.body.contains(runtime.sheetPortalNode)) {
    return runtime.sheetPortalNode
  }
  let existing = typeof document !== 'undefined' ? document.getElementById('sheet-portal') : null
  if (!existing && typeof document !== 'undefined' && document.body) {
    existing = document.createElement('div')
    existing.id = 'sheet-portal'
    document.body.appendChild(existing)
  }
  runtime.sheetPortalNode = existing
  return existing
}

export function closeSheet() {
  state.sheet = state.sheetReturn || null
  state.sheetReturn = null
  syncSheetPortal()
}

export function switchSheet(nextSheet) {
  state.sheet = nextSheet
  syncSheetPortal()
}

export function syncSheetPortal(force = false) {
  const portal = getSheetPortal()
  if (!portal) return

  const target = state.sheet || null
  if (!force && runtime.activeSheet === target && runtime.sheetNode && portal.contains(runtime.sheetNode)) {
    return
  }

  if (!target) {
    runtime.activeSheet = null
    runtime.sheetNode = null
    portal.replaceChildren()
    return
  }

  let node = null
  if (target === 'settings') node = settingsSheet()
  else if (target === 'model') node = renderModelSheet()
  else if (target === 'quota') node = quotaSheet()
  else if (target === 'pwa') node = pwaSheet()
  else if (target === 'power') node = powerSheet()

  runtime.activeSheet = target
  runtime.sheetNode = node

  if (node) {
    portal.replaceChildren(node)
  } else {
    portal.replaceChildren()
  }
}

runtime.syncSheetPortal = syncSheetPortal
