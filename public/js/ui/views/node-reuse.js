/**
 * Lets a stream-driven re-render move unchanged nodes forward instead of
 * building them again. While a reply streams, the conversation is re-rendered
 * many times per second and only the tail message actually changes, so
 * rebuilding every message (Markdown, tables, tool cards) is what saturates
 * the main thread.
 *
 * Reuse only happens inside the lane that opts in (net/mux.js stream renders).
 * Every other render — a settings toggle, expanding a card, any direct user
 * action — rebuilds for real, so state that lives outside the source objects
 * still takes effect.
 */
let pool = null

export function beginNodeReuse() {
  const scroller = document.querySelector('.chat-scroll')
  pool = scroller && scroller.isConnected ? [...scroller.children] : []
}

export function endNodeReuse() {
  pool = null
}

/** The node this source was rendered from last time, if it is still around. */
export function claimReused(refs) {
  if (!pool) return null
  for (let index = 0; index < pool.length; index += 1) {
    const node = pool[index]
    if (!node || node.__srcRefs === undefined) continue
    if (!sameRefs(node.__srcRefs, refs)) continue
    pool[index] = null
    return node
  }
  return null
}

/** Remember what a freshly built node was made from. */
export function markReusable(node, refs) {
  if (node) node.__srcRefs = refs
  return node
}

function sameRefs(a, b) {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}
