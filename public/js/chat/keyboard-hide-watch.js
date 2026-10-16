/**
 * Detects the shell hiding its own keyboard while a field keeps focus.
 *
 * Xiaomi's soft keyboard collapses on its own ▼ chevron without blurring the
 * textarea, and its PWA window never tells the page about keyboard geometry
 * (see utils/virtual-keyboard.js). A lifted composer would then hang above an
 * empty screen with nothing focused away.
 *
 * The layout still answers the question without any geometry: while the
 * keyboard is up, everything below the composer belongs to the keyboard
 * window, so a touch that reaches the page down there means the keyboard is
 * gone. Typing, or touching the composer itself, says it is back.
 */
import {
  isTextEntry,
  markKeyboardHidden,
  markKeyboardShown,
  shellIgnoresKeyboard,
} from '../utils/virtual-keyboard.js'

// The composer keeps a padding row under its toolbar, so nearby touches are
// still page even with the keyboard up — only clear taps further down count.
const MIN_GAP = 40

export function installKeyboardHideWatch() {
  document.addEventListener('pointerdown', (ev) => {
    if (!shellIgnoresKeyboard()) return
    if (!isTextEntry(document.activeElement)) return
    const bar = document.querySelector('.chat-inputbar')
    if (!bar) return
    const bottom = bar.getBoundingClientRect().bottom
    if (ev.clientY > bottom + MIN_GAP) markKeyboardHidden()
    else if (ev.clientY <= bottom) markKeyboardShown()
  }, true)

  const shown = () => markKeyboardShown()
  for (const type of ['keydown', 'input', 'compositionstart']) {
    window.addEventListener(type, shown, true)
  }
  window.addEventListener('focusin', shown)
  window.addEventListener('focusout', shown)
}
