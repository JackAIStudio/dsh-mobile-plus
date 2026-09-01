/**
 * Scroll management and viewport pinning.
 */
import { runtime, chat } from '../state/state.js'

export function nearBottom(node) {
    return node.scrollHeight - node.scrollTop - node.clientHeight < 80
  }

export function captureChatScroll() {
    const existing = document.querySelector('.chat-scroll')
    if (!existing || !existing.isConnected) return
    if (chatScroll.restoring) return
    chatScroll.top = existing.scrollTop
    chatScroll.stick = nearBottom(existing)
  }

export function onChatScroll(ev) {
    if (chatScroll.restoring) return
    const node = ev.currentTarget
    chatScroll.top = node.scrollTop
    chatScroll.stick = nearBottom(node)
  }

export function applyChatScroll(scroller) {
    if (!scroller) return
    const gen = ++chatScroll.gen
    chatScroll.restoring = true
    const apply = () => {
      if (gen !== chatScroll.gen || !scroller.isConnected) return
      if (prependAdjust) {
        const delta = scroller.scrollHeight - prependAdjust.height
        scroller.scrollTop = prependAdjust.top + delta
        chatScroll.top = scroller.scrollTop
        prependAdjust = null
        return
      }
      if (chatScroll.stick) {
        scroller.scrollTop = scroller.scrollHeight
        chatScroll.top = scroller.scrollTop
      } else {
        scroller.scrollTop = Math.min(chatScroll.top, scroller.scrollHeight)
      }
    }
    apply()
    requestAnimationFrame(() => {
      apply()
      requestAnimationFrame(() => {
        apply()
        if (gen === chatScroll.gen) chatScroll.restoring = false
      })
    })
    const imgs = scroller.querySelectorAll('img')
    for (const img of imgs) {
      if (img.complete) continue
      const settle = () => {
        if (gen !== chatScroll.gen || !scroller.isConnected || !chatScroll.stick) return
        scroller.scrollTop = scroller.scrollHeight
        chatScroll.top = scroller.scrollTop
      }
      img.addEventListener('load', settle, { once: true })
      img.addEventListener('error', settle, { once: true })
    }
  }

export function captureListScroll() {
    const existing = document.querySelector('.mobile-list')
    if (!existing || !existing.isConnected) return
    listScroll.top = existing.scrollTop
  }

export function onListScroll(ev) {
    listScroll.top = ev.currentTarget.scrollTop
  }

export function applyListScroll(list) {
    if (!list) return
    const top = listScroll.top
    list.scrollTop = top
    requestAnimationFrame(() => {
      if (list.isConnected) list.scrollTop = top
    })
  }

export function captureTodoScroll() {
    const existing = document.querySelector('.todo-dock-list')
    if (!existing || !existing.isConnected) return
    todoScroll.top = existing.scrollTop
    todoScroll.stick = nearBottom(existing)
  }

export function onTodoScroll(ev) {
    const node = ev.currentTarget
    todoScroll.top = node.scrollTop
    todoScroll.stick = nearBottom(node)
  }

export function applyTodoScroll(list) {
    if (!list) return
    if (todoScroll.stick) list.scrollTop = list.scrollHeight
    else list.scrollTop = Math.min(todoScroll.top, list.scrollHeight)
    requestAnimationFrame(() => {
      if (!list.isConnected) return
      if (todoScroll.stick) list.scrollTop = list.scrollHeight
      else list.scrollTop = Math.min(todoScroll.top, list.scrollHeight)
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

export function installOverscrollLock() {
    let startY = 0
    document.addEventListener('touchstart', (ev) => {
      if (ev.touches.length === 1) startY = ev.touches[0].clientY
    }, { passive: true, capture: true })
    document.addEventListener('touchmove', (ev) => {
      if (ev.touches.length !== 1) return
      // Let iOS keep long-press Paste / caret drag on fields. preventDefault
      // on capture here otherwise swallows the callout.
      if (ev.target && ev.target.closest && ev.target.closest('input, textarea, [contenteditable="true"]')) return
      const dy = ev.touches[0].clientY - startY
      const pane = scrollableAncestor(ev.target)
      if (!pane) {
        ev.preventDefault()
        return
      }
      const atTop = pane.scrollTop <= 0
      const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1
      if ((atTop && dy > 0) || (atBottom && dy < 0)) ev.preventDefault()
    }, { passive: false, capture: true })
  }

export function pinViewport() {
    const root = document.documentElement
    const body = document.body
    let ticking = false

    const apply = () => {
      ticking = false
      const vv = window.visualViewport
      const height = vv ? vv.height : window.innerHeight
      const width = vv ? vv.width : window.innerWidth
      const offsetTop = vv ? vv.offsetTop : 0
      const offsetLeft = vv ? vv.offsetLeft : 0
      // iOS keeps innerHeight at the layout size when the keyboard is up;
      // the visual viewport is what actually shrinks (and often shifts).
      const kbOpen = (window.innerHeight - height) > 80 || offsetTop > 0

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
      const composerFocused = composerNode && document.activeElement === composerNode
      if ((window.scrollX || window.scrollY) && !imeComposing && !composerFocused) {
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
