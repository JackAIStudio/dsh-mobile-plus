/**
 * Fills the space a lifted composer leaves behind.
 *
 * Overlay shells can hide their keyboard without telling the page (see
 * utils/virtual-keyboard.js), and then the lifted composer hangs above an
 * unexplained blank band. While the keyboard is up that band is hidden under
 * it, so anything visible here means the keyboard is gone: name it, and let a
 * tap (handled by chat/keyboard-hide-watch.js) drop the composer back down.
 */
import { estimatedKeyboardInset, isTextEntry, shellIgnoresKeyboard } from '../utils/virtual-keyboard.js'

// Below this the band is just the composer's own padding while the keyboard is
// up — nothing to explain, and a chip there would only be noise.
const CHIP_MIN_BAND = 80

let strip = null
let chip = null

function ensureNodes() {
  if (strip && strip.isConnected) return
  chip = document.createElement('div')
  chip.className = 'kb-gap-chip'
  chip.textContent = '⌄ 键盘已收起 · 轻点归位'
  strip = document.createElement('div')
  strip.className = 'kb-gap-strip'
  strip.setAttribute('aria-hidden', 'true')
  strip.appendChild(chip)
  document.body.appendChild(strip)
}

function refresh() {
  const lifted = shellIgnoresKeyboard() && isTextEntry(document.activeElement) && estimatedKeyboardInset() > 0
  if (!lifted) {
    if (strip) strip.hidden = true
    return
  }
  ensureNodes()
  const top = Math.round(document.body.getBoundingClientRect().bottom)
  const band = Math.round(window.innerHeight) - top
  if (band < CHIP_MIN_BAND) {
    strip.hidden = true
    return
  }
  strip.hidden = false
  strip.style.top = `${top}px`
  chip.hidden = false
}

export function installKeyboardGapStrip() {
  // mp-viewport-applied fires at the end of every viewport pin, which is
  // exactly when the lifted height changes — no polling needed.
  window.addEventListener('mp-viewport-applied', refresh)
  window.addEventListener('resize', refresh)
  window.addEventListener('focusin', () => setTimeout(refresh, 40))
  window.addEventListener('focusout', () => setTimeout(refresh, 40))
  window.addEventListener('mp-keyboard-silent', refresh)
  refresh()
}
