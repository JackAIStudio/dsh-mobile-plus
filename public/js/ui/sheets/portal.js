/**
 * Dedicated Sheet Portal and top-level overlay manager.
 * Isolates bottom sheets from main view re-renders to preserve scroll, state, and focus.
 */
import { state, runtime } from '../../state/state.js'
import { settingsSheet } from './settings-sheet.js'
import { renderModelSheet } from './model-sheet.js'
import { pwaSheet, powerSheet } from './system-sheets.js'
import { renderWorkspacePickerSheet } from './workspace-sheet.js'
import { renderChatContextSheet } from './context-sheet.js'
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
  const isCurrentActive = runtime.activeSheet === target && runtime.sheetNode && portal.contains(runtime.sheetNode)
  if (!force && isCurrentActive) {
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
  else if (target === 'workspace-pick') node = renderWorkspacePickerSheet()
  else if (target === 'chat-context') node = renderChatContextSheet()

  const isUpdate = isCurrentActive && target === runtime.activeSheet

  if (isUpdate && node) {
    node.classList.add('no-anim')
    const sheetEl = node.querySelector('.sheet')
    if (sheetEl) sheetEl.classList.add('no-anim')
    const oldBody = runtime.sheetNode ? runtime.sheetNode.querySelector('.sheet-body') : null
    const scrollTop = oldBody ? oldBody.scrollTop : 0
    runtime.activeSheet = target
    runtime.sheetNode = node
    portal.replaceChildren(node)
    const newBody = node.querySelector('.sheet-body')
    if (newBody && scrollTop) newBody.scrollTop = scrollTop
  } else {
    runtime.activeSheet = target
    runtime.sheetNode = node
    if (node) {
      portal.replaceChildren(node)
    } else {
      portal.replaceChildren()
    }
  }
}

runtime.syncSheetPortal = syncSheetPortal
