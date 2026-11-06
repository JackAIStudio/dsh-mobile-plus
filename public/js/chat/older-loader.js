/**
 * Pulling down through a conversation means "look further back", not "reload".
 *
 * The chat pane is the only scroller on the page, so reaching its top is the
 * reader asking for the previous page. This module owns the decision — arm on
 * first arrival, fire once, re-arm only after the reader scrolls back down —
 * so one long swipe cannot page through the whole history and a render that
 * restores the scroll position cannot fire a second request.
 */
import { chat } from '../state/state.js'

/** Start a little before the very top so the last messages stay in view. */
const TRIGGER_PX = 120
/** Scrolling back down 2x that distance re-arms the gesture. */
const REARM_PX = TRIGGER_PX * 2

let armed = true

/** A newly opened conversation starts at the bottom, so the gesture is fresh. */
export function resetOlderLoader() {
  armed = true
}

/** True once per arrival at the top, only while there is more to fetch. */
export function shouldLoadOlder(node) {
  if (!node) return false
  const fromTop = node.scrollTop
  if (fromTop > REARM_PX) {
    armed = true
    return false
  }
  if (!armed || fromTop > TRIGGER_PX) return false
  if (!chat.hasOlder || chat.loadingOlder) return false
  armed = false
  return true
}
