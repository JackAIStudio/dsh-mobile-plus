/**
 * One-time drag-to-fit calibration for shells that hide the keyboard from the
 * page (see utils/virtual-keyboard.js). The bar appears above the composer the
 * first time a field is focused there: pull it down until the composer sits on
 * the keyboard's top edge, and that offset is remembered. Keyboards differ by
 * skin, language rows and floating toolbars, and those shells never report a
 * size, so this is how any of them can be matched exactly.
 */
import { el } from '../utils/dom.js'
import {
  hasKeyboardInsetRatio,
  isTextEntry,
  keyboardInsetRatio,
  setKeyboardInsetRatio,
  shellIgnoresKeyboard,
} from '../utils/virtual-keyboard.js'

let bar = null
let watchTimer = 0

function liveBar() {
  return bar && bar.isConnected ? bar : null
}

function unmount() {
  const node = liveBar()
  if (node) node.remove()
  bar = null
}

function repin() {
  window.dispatchEvent(new Event('resize'))
}

function mount(host) {
  const existing = liveBar()
  if (existing) {
    // The chat re-renders the composer on its own schedule; re-attach instead
    // of rebuilding, so an in-flight drag keeps working.
    if (existing.parentElement !== host) host.prepend(existing)
    return
  }
  const value = el('span', { class: 'kb-fit-value' }, [`${Math.round(keyboardInsetRatio() * 100)}%`])
  const done = el('button', {
    type: 'button',
    class: 'kb-fit-done',
    'aria-label': '完成，保持这个高度',
    onclick: (ev) => {
      ev.stopPropagation()
      setKeyboardInsetRatio(keyboardInsetRatio())
      unmount()
    },
  }, ['✓'])
  bar = el('div', {
    class: 'kb-fit-bar',
    role: 'group',
    'aria-label': '键盘高度对准条',
  }, [
    el('span', { class: 'kb-fit-grip', 'aria-hidden': 'true' }, ['⣿']),
    el('span', { class: 'kb-fit-hint' }, ['拖动对准键盘上沿']),
    value,
    done,
  ])

  bar.addEventListener('pointerdown', (ev) => {
    if (ev.target === done) return
    ev.preventDefault()
    const startY = ev.clientY
    const startRatio = keyboardInsetRatio()
    const viewport = Math.max(1, window.innerHeight)
    bar.dataset.dragging = '1'
    try {
      bar.setPointerCapture(ev.pointerId)
    } catch {
      /* capture is a nicety; the listeners below still work */
    }
    const onMove = (moveEv) => {
      // Down on the screen means closer to the keyboard, i.e. a smaller inset.
      const next = setKeyboardInsetRatio(startRatio - (moveEv.clientY - startY) / viewport, false)
      value.textContent = `${Math.round(next * 100)}%`
      repin()
    }
    const onEnd = () => {
      delete bar.dataset.dragging
      setKeyboardInsetRatio(keyboardInsetRatio())
      repin()
      bar.removeEventListener('pointermove', onMove)
      bar.removeEventListener('pointerup', onEnd)
      bar.removeEventListener('pointercancel', onEnd)
    }
    bar.addEventListener('pointermove', onMove)
    bar.addEventListener('pointerup', onEnd)
    bar.addEventListener('pointercancel', onEnd)
  })

  host.prepend(bar)
}

export function installKeyboardFitBar() {
  const refresh = () => {
    const host = document.querySelector('.chat-inputbar')
    const focused = document.activeElement
    const wanted = shellIgnoresKeyboard() && !hasKeyboardInsetRatio() && host && isTextEntry(focused)
    if (!wanted) {
      unmount()
      stopWatch()
      return
    }
    mount(host)
    startWatch(refresh)
  }
  window.addEventListener('focusin', () => setTimeout(refresh, 40))
  window.addEventListener('focusout', () => setTimeout(refresh, 40))
  // The shell is only known to be silent a beat after focus, once it had its
  // chance to resize the viewport.
  window.addEventListener('mp-keyboard-silent', refresh)
}

/** Only runs while calibration is pending, to survive composer re-renders. */
function startWatch(refresh) {
  if (watchTimer) return
  watchTimer = setInterval(refresh, 400)
}

function stopWatch() {
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = 0
}

