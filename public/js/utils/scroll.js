/**
 * Scroll management and viewport pinning.
 */
import { runtime, chat } from '../state/state.js'
import { keyboardInsetPx, estimatedKeyboardInset, installKeyboardInsetProbe } from './virtual-keyboard.js'

export function nearBottom(node) {
    return node.scrollHeight - node.scrollTop - node.clientHeight < 80
  }

export function captureChatScroll() {
    const existing = document.querySelector('.chat-scroll')
    if (!existing || !existing.isConnected) return
    if (runtime.chatScroll.restoring) return
    runtime.chatScroll.top = existing.scrollTop
    runtime.chatScroll.stick = nearBottom(existing)
  }

export function onChatScroll(ev) {
    if (runtime.chatScroll.restoring) return
    const node = ev.currentTarget
    runtime.chatScroll.top = node.scrollTop
    runtime.chatScroll.stick = nearBottom(node)
  }

export function applyChatScroll(scroller) {
    if (!scroller) return
    const gen = ++runtime.chatScroll.gen
    runtime.chatScroll.restoring = true
    const apply = () => {
      if (gen !== runtime.chatScroll.gen || !scroller.isConnected) return
      if (runtime.prependAdjust) {
        const delta = scroller.scrollHeight - runtime.prependAdjust.height
        if (runtime.prependAdjust.wasNearTop) {
          scroller.scrollTop = Math.max(0, delta - 40)
        } else {
          scroller.scrollTop = runtime.prependAdjust.top + delta
        }
        runtime.chatScroll.top = scroller.scrollTop
        runtime.prependAdjust = null
        return
      }
      if (runtime.chatScroll.stick) {
        scroller.scrollTop = scroller.scrollHeight
        runtime.chatScroll.top = scroller.scrollTop
      } else {
        scroller.scrollTop = Math.min(runtime.chatScroll.top, scroller.scrollHeight)
      }
    }
    apply()
    requestAnimationFrame(() => {
      apply()
      requestAnimationFrame(() => {
        apply()
        if (gen === runtime.chatScroll.gen) runtime.chatScroll.restoring = false
      })
    })
    const imgs = scroller.querySelectorAll('img')
    for (const img of imgs) {
      if (img.complete) continue
      const settle = () => {
        if (gen !== runtime.chatScroll.gen || !scroller.isConnected || !runtime.chatScroll.stick) return
        scroller.scrollTop = scroller.scrollHeight
        runtime.chatScroll.top = scroller.scrollTop
      }
      img.addEventListener('load', settle, { once: true })
      img.addEventListener('error', settle, { once: true })
    }
  }

export function captureListScroll() {
    const existing = document.querySelector('.mobile-list')
    if (!existing || !existing.isConnected) return
    runtime.listScroll.top = existing.scrollTop
  }

export function onListScroll(ev) {
    runtime.listScroll.top = ev.currentTarget.scrollTop
  }

export function applyListScroll(list) {
    if (!list) return
    const top = runtime.listScroll.top
    list.scrollTop = top
    requestAnimationFrame(() => {
      if (list.isConnected) list.scrollTop = top
    })
  }

export function captureTodoScroll() {
    const existing = document.querySelector('.todo-dock-list')
    if (!existing || !existing.isConnected) return
    runtime.todoScroll.top = existing.scrollTop
    runtime.todoScroll.stick = nearBottom(existing)
  }

export function onTodoScroll(ev) {
    const node = ev.currentTarget
    runtime.todoScroll.top = node.scrollTop
    runtime.todoScroll.stick = nearBottom(node)
  }

export function applyTodoScroll(list) {
    if (!list) return
    if (runtime.todoScroll.stick) list.scrollTop = list.scrollHeight
    else list.scrollTop = Math.min(runtime.todoScroll.top, list.scrollHeight)
    requestAnimationFrame(() => {
      if (!list.isConnected) return
      if (runtime.todoScroll.stick) list.scrollTop = list.scrollHeight
      else list.scrollTop = Math.min(runtime.todoScroll.top, list.scrollHeight)
    })
  }

export function scrollableAncestor(node) {
    let el = node
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.nodeType === 1) {
        const tag = el.tagName
        if (tag === 'TEXTAREA' && el.scrollHeight > el.clientHeight + 1) return el
        const oy = window.getComputedStyle(el).overflowY
        if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1) {
          return el
        }
      }
      el = el.parentElement
    }
    return null
  }

/** Nearest ancestor that can still pan sideways by dx (markdown tables, code
    blocks, image strips). null = the gesture is not a horizontal pan. */
export function horizontalScrollerFor(node, dx) {
    let el = node
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.nodeType === 1) {
        const ox = window.getComputedStyle(el).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'overlay') {
          const max = el.scrollWidth - el.clientWidth
          const room = dx < 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 1
          if (max > 1 && room) return el
        }
      }
      el = el.parentElement
    }
    return null
  }

/** Pure decision for the overscroll lock: cancel only when this pan is really
    vertical rubber-banding at a pane edge. A horizontal pan (or one that can
    still move an inner sideways scroller) must reach the browser, otherwise
    preventDefault kills that scroller instead of the overscroll. */
export function shouldCancelPan({ dx, dy, pane, horizontalPan }) {
    if (horizontalPan) return false
    if (Math.abs(dx) > Math.abs(dy)) return false
    if (!pane) return true
    const atTop = pane.scrollTop <= 0
    const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1
    return (atTop && dy > 0) || (atBottom && dy < 0)
  }

export function installOverscrollLock() {
    let startX = 0
    let startY = 0
    document.addEventListener('touchstart', (ev) => {
      if (ev.touches.length === 1) {
        startX = ev.touches[0].clientX
        startY = ev.touches[0].clientY
      }
    }, { passive: true, capture: true })
    document.addEventListener('touchmove', (ev) => {
      if (ev.touches.length !== 1) return
      // Let iOS keep long-press Paste / caret drag on fields. preventDefault
      // on capture here otherwise swallows the callout.
      if (ev.target && ev.target.closest && ev.target.closest('input, textarea, [contenteditable="true"]')) return
      const dx = ev.touches[0].clientX - startX
      const dy = ev.touches[0].clientY - startY
      const pane = scrollableAncestor(ev.target)
      const horizontalPan = horizontalScrollerFor(ev.target, dx) !== null
      if (shouldCancelPan({ dx, dy, pane, horizontalPan })) ev.preventDefault()
    }, { passive: false, capture: true })
  }

export function pinViewport() {
    const root = document.documentElement
    const body = document.body
    let ticking = false

    const apply = () => {
      ticking = false
      const vv = window.visualViewport
      const width = vv ? vv.width : window.innerWidth
      const offsetTop = vv ? vv.offsetTop : 0
      const offsetLeft = vv ? vv.offsetLeft : 0
      // iOS keeps innerHeight at the layout size when the keyboard is up;
      // the visual viewport is what actually shrinks (and often shifts).
      const visualHeight = vv ? vv.height : window.innerHeight
      const viewportShrank = (window.innerHeight - visualHeight) > 80 || offsetTop > 0
      // Overlay shells report nothing through the viewport, so fall back to
      // the virtual keyboard rect and size the body ourselves. Never apply
      // both: on shells that already shrink, the viewport is the source of
      // truth and the rect would double-count the keys.
      const kbInset = viewportShrank ? 0 : keyboardInsetPx() || estimatedKeyboardInset()
      const height = viewportShrank
        ? visualHeight
        : Math.max(160, window.innerHeight - kbInset)
      const kbOpen = viewportShrank || kbInset > 0
      if (kbInset > 0) root.style.setProperty('--m-kb-inset', `${kbInset}px`)
      else root.style.removeProperty('--m-kb-inset')

      // Size the fixed body only. Shrinking <html> itself can make iOS
      // revise the layout viewport and retrigger visualViewport resize.
      body.style.height = `${height}px`
      body.style.width = `${width}px`
      // Glue the fixed page to the visual viewport with top/left — not
      // transform. A transformed ancestor hides the iOS caret and cancels
      // IME composition (pinyin committed as Latin). Height-only pin still
      // leaves the composer at the top of the layout viewport while iOS
      // caret-scrolls offsetTop.
      body.style.top = `${offsetTop}px`
      body.style.left = `${offsetLeft}px`
      body.style.transform = ''
      if (kbOpen) root.dataset.keyboard = '1'
      else delete root.dataset.keyboard
      // scrollTo while the composer is focused fights iOS caret-scroll and
      // cancels pinyin composition. The top/left pin already tracks offsetTop.
      const composerFocused = runtime.composerNode && document.activeElement === runtime.composerNode
      if ((window.scrollX || window.scrollY) && !runtime.imeComposing && !composerFocused) {
        window.scrollTo(0, 0)
      }
    }

    const schedule = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(apply)
    }

    const afterKeyboard = () => {
      schedule()
      requestAnimationFrame(schedule)
      setTimeout(schedule, 50)
      setTimeout(schedule, 300)
    }

    apply()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    installKeyboardInsetProbe(afterKeyboard)
    window.addEventListener('orientationchange', afterKeyboard)
    window.addEventListener('focusin', (ev) => {
      // Resizing the fixed body during pair-input focusin makes iOS blur the
      // field and dismiss the keyboard (then there is nothing to paste into).
      const t = ev.target
      if (t && t.classList && t.classList.contains('mobile-pairInput')) return
      afterKeyboard()
    })
    window.addEventListener('focusout', afterKeyboard)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule)
      window.visualViewport.addEventListener('scroll', schedule)
    }
  }
