/**
 * "Back to the newest" chip for a reader who is up in the history.
 *
 * Streaming replies never pull the viewport back while somebody is reading
 * (the scroll lock already guarantees that), so that reader needs a way home.
 * The chip appears once they leave the bottom, counts what arrived meanwhile,
 * and disappears as soon as they are back at the newest message.
 */
import { el } from '../utils/dom.js'
import { scrollToLatest } from './timeline.js'

/** Far enough from the bottom that incidental jitter cannot flip it. */
const AWAY_PX = 200

let chip = null
let unseen = 0
let lastCount = 0
let away = false

function label() {
  return unseen > 0 ? `${unseen} 条新消息 ↓` : '回到最新 ↓'
}

function paint() {
  if (!chip) return
  chip.classList.toggle('is-visible', away)
  chip.classList.toggle('has-unseen', unseen > 0)
  const text = chip.querySelector('.chat-latest-text')
  if (text) text.textContent = label()
  chip.setAttribute('aria-label', unseen > 0 ? `${unseen} 条新消息，回到最新` : '回到最新消息')
}

export function ensureLatestChip() {
  if (chip) return chip
  chip = el('button', {
    type: 'button',
    class: 'chat-latest-chip',
    'aria-live': 'polite',
    onclick: () => {
      unseen = 0
      away = false
      scrollToLatest()
      paint()
    },
  }, [
    el('span', { class: 'chat-latest-text' }, ['回到最新 ↓']),
  ])
  return chip
}

function distanceFromBottom(scroller) {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
}

/**
 * Called on every reader scroll. Only the pane's own metrics decide this, so
 * a render that writes `scrollTop` cannot leave the chip showing.
 */
export function noteReaderScroll(scroller) {
  if (!scroller) return
  const next = distanceFromBottom(scroller) > AWAY_PX
  if (next === away) return
  away = next
  if (!away) unseen = 0
  paint()
}

/** Count messages that landed while the reader was away. */
export function noteMessageCount(count) {
  if (typeof count !== 'number') return
  if (away && count > lastCount) unseen += count - lastCount
  lastCount = count
  paint()
}

/** Re-evaluate after a render changed the pane's height or the message count. */
export function syncLatestChip(scroller, count) {
  if (scroller) {
    away = distanceFromBottom(scroller) > AWAY_PX
    if (!away) unseen = 0
  }
  if (typeof count === 'number') {
    if (away && count > lastCount) unseen += count - lastCount
    lastCount = count
  }
  paint()
}

/** A session switch drops the counter and hides the chip. */
export function resetLatestChip(count) {
  unseen = 0
  away = false
  lastCount = typeof count === 'number' ? count : 0
  paint()
}
