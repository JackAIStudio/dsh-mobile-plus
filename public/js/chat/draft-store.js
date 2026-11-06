/**
 * Draft survival without leaning on the page never reloading.
 *
 * The composer used to live only in memory, so any reload — an update, an
 * Android process kill, a WebView crash — threw away a half-typed prompt.
 * Keep the text per conversation in sessionStorage: it survives a reload of
 * this tab and dies with the tab, which is what a draft is. A few KB per
 * keystroke is far cheaper than losing the prompt.
 */
import { state } from '../state/state.js'

const KEY_PREFIX = 'dsh-mp-draft:'
const MAX_LEN = 20000

let boundSession = ''
let timer = 0

function storageKey(sessionId) {
  return sessionId ? KEY_PREFIX + sessionId : ''
}

export function readStoredDraft(sessionId) {
  const key = storageKey(sessionId)
  if (!key) return ''
  try {
    const raw = sessionStorage.getItem(key)
    return raw === null ? '' : raw
  } catch {
    return ''
  }
}

function write(sessionId, value) {
  const key = storageKey(sessionId)
  if (!key) return
  try {
    if (value) sessionStorage.setItem(key, value.slice(0, MAX_LEN))
    else sessionStorage.removeItem(key)
  } catch {
    /* private mode / quota: losing the draft is the old behaviour */
  }
}

/**
 * Bind the store to the conversation on screen. The previous conversation's
 * text was already saved while typing, so switching must not overwrite it with
 * the new, empty draft.
 */
export function bindDraftSession(sessionId) {
  if (sessionId === boundSession) return
  if (timer) {
    clearTimeout(timer)
    timer = 0
  }
  boundSession = sessionId || ''
}

/** Save the composer's current text under the bound conversation. */
export function saveDraft() {
  write(boundSession, state.draft)
}

/** Sending consumes the draft; drop the copy too. */
export function clearDraft() {
  write(boundSession, '')
}

/** Debounced save: one write per pause, not one per keystroke. */
export function queueDraftSave() {
  if (!boundSession) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = 0
    saveDraft()
  }, 500)
}
