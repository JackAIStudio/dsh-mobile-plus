/**
 * Tuner for the estimated keyboard height used by overlay-only shells
 * (see utils/virtual-keyboard.js). Keyboards differ by skin, language row
 * count and floating toolbars, and those shells never report a size, so the
 * phone user is the only one who can say what looks right.
 */
import { el } from '../../utils/dom.js'
import {
  clearKeyboardInsetRatio,
  keyboardInsetRatio,
  setKeyboardInsetRatio,
  shellIgnoresKeyboard,
} from '../../utils/virtual-keyboard.js'
import { closeSheet } from './portal.js'

const STEP = 0.02

function stepButton(label, ariaLabel, onPick) {
  return el('button', {
    type: 'button',
    class: 'kb-step-btn',
    'aria-label': ariaLabel,
    onclick: onPick,
  }, [label])
}

export function keyboardInsetSection() {
  // Only shells that hide the keyboard need this knob; everywhere else the
  // browser reports the real height and there is nothing to tune.
  if (!shellIgnoresKeyboard()) return null
  const value = el('span', { class: 'kb-step-value' }, [`${Math.round(keyboardInsetRatio() * 100)}%`])
  const bump = (delta) => {
    const next = setKeyboardInsetRatio(keyboardInsetRatio() + delta)
    value.textContent = `${Math.round(next * 100)}%`
    // Re-pin the viewport so a focused composer follows immediately.
    window.dispatchEvent(new Event('resize'))
  }
  return el('div', { class: 'sheet-section' }, [
    el('div', { class: 'sheet-section-title' }, ['输入框与键盘']),
    el('div', { class: 'sheet-nav-row' }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['键盘高度']),
        el('span', { class: 'sheet-toggle-desc' }, ['输入框被键盘挡住时调大，悬得太高时调小']),
      ]),
      el('div', { class: 'kb-step-group' }, [
        stepButton('−', '调低键盘高度', () => bump(-STEP)),
        value,
        stepButton('+', '调高键盘高度', () => bump(STEP)),
      ]),
    ]),
    el('button', {
      type: 'button',
      class: 'sheet-nav-row',
      'aria-label': '重新对准键盘',
      onclick: () => {
        clearKeyboardInsetRatio()
        value.textContent = `${Math.round(keyboardInsetRatio() * 100)}%`
        closeSheet()
        window.dispatchEvent(new Event('resize'))
      },
    }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['重新对准键盘']),
        el('span', { class: 'sheet-toggle-desc' }, ['回到拖动对准条，适合换键盘后重新标定']),
      ]),
      el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['↔']),
    ]),
  ])
}
