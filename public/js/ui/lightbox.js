/**
 * Fullscreen image preview with pinch-to-zoom and pan gestures.
 */
import { runtime } from '../state/state.js'
import { el } from '../utils/dom.js'

export function composerSrc(img) {
    if (img && typeof img.preview === 'string' && img.preview !== '') return img.preview
    if (img && typeof img.fullData === 'string' && img.fullData !== '') {
      return `data:${img.mediaType || 'image/jpeg'};base64,${img.fullData}`
    }
    return ''
  }

export function closeImageLightbox() {
    if (lightboxCleanup) {
      lightboxCleanup()
      lightboxCleanup = null
    }
    if (lightboxEsc) {
      document.removeEventListener('keydown', lightboxEsc)
      lightboxEsc = null
    }
    if (lightboxNode) {
      lightboxNode.remove()
      lightboxNode = null
    }
  }

export function openImageLightbox(src) {
    if (!src) return
    closeImageLightbox()

    const img = el('img', { class: 'img-lightbox-img', src, alt: '图片预览' })
    img.draggable = false
    const stage = el('div', { class: 'img-lightbox-stage' }, [img])
    const closeBtn = el('button', {
      type: 'button',
      class: 'img-lightbox-close',
      'aria-label': '关闭预览',
    }, ['×'])
    const hint = el('div', { class: 'img-lightbox-hint' }, ['点一下关闭 · 双击或捏合放大'])
    const node = el('div', {
      class: 'img-lightbox',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '图片预览',
    }, [stage, closeBtn, hint])
    node.dataset.src = src
    closeBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      closeImageLightbox()
    })
    node.addEventListener('touchmove', (ev) => { ev.preventDefault() }, { passive: false })
    attachLightboxZoom(stage, img)
    lightboxEsc = (ev) => { if (ev.key === 'Escape') closeImageLightbox() }
    document.addEventListener('keydown', lightboxEsc)
    lightboxNode = node
    document.body.append(node)
  }

export function attachLightboxZoom(stage, img) {
    let scale = 1
    let x = 0
    let y = 0
    let pan = null
    let pinch0 = null
    let lastTapAt = 0
    let lastTapX = 0
    let lastTapY = 0
    let moved = false
    let closeTimer = 0
    let mouseDown = false
    let ignoreMouseUntil = 0

    const cancelCloseTimer = () => {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = 0
      }
    }

    img.style.transformOrigin = '0 0'
    const apply = () => {
      img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    }

    const zoomAt = (cx, cy, next) => {
      next = Math.min(5, Math.max(1, next))
      if (next === scale) return
      const rect = img.getBoundingClientRect()
      const prev = scale || 1
      x += ((cx - rect.left) / prev) * (prev - next)
      y += ((cy - rect.top) / prev) * (prev - next)
      scale = next
      if (scale === 1) {
        x = 0
        y = 0
      }
    }

    const endGesture = (clientX, clientY, target) => {
      pinch0 = null
      pan = null
      mouseDown = false
      if (scale < 1.02) {
        scale = 1
        x = 0
        y = 0
        apply()
      }
      if (moved) {
        lastTapAt = 0
        return
      }
      const now = Date.now()
      const isDouble = now - lastTapAt < 300 && Math.hypot(clientX - lastTapX, clientY - lastTapY) < 28
      if (isDouble) {
        lastTapAt = 0
        cancelCloseTimer()
        if (scale > 1.05) {
          scale = 1
          x = 0
          y = 0
        } else {
          zoomAt(clientX, clientY, 2.6)
        }
        apply()
        return
      }
      lastTapAt = now
      lastTapX = clientX
      lastTapY = clientY
      if (scale > 1.05) {
        if (target !== img) {
          scale = 1
          x = 0
          y = 0
          apply()
        }
        return
      }
      /* Full-bleed screenshots leave no blank margin; delay so a double-tap
         can still zoom, then close on a single tap anywhere. */
      closeTimer = setTimeout(() => {
        closeTimer = 0
        if (lastTapAt === now) closeImageLightbox()
      }, 320)
    }

    const onTouchStart = (ev) => {
      ignoreMouseUntil = Date.now() + 700
      cancelCloseTimer()
      if (ev.touches.length === 1) {
        moved = false
        pan = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, ox: x, oy: y }
        pinch0 = null
      } else if (ev.touches.length >= 2) {
        const a = ev.touches[0]
        const b = ev.touches[1]
        pinch0 = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale }
        pan = null
        moved = true
      }
    }

    const onTouchMove = (ev) => {
      ev.preventDefault()
      if (ev.touches.length >= 2 && pinch0 && pinch0.dist > 0) {
        const a = ev.touches[0]
        const b = ev.touches[1]
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        zoomAt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, pinch0.scale * (dist / pinch0.dist))
        apply()
        return
      }
      if (ev.touches.length === 1 && pan) {
        const dx = ev.touches[0].clientX - pan.x
        const dy = ev.touches[0].clientY - pan.y
        if (Math.hypot(dx, dy) > 6) moved = true
        if (scale > 1) {
          x = pan.ox + dx
          y = pan.oy + dy
          apply()
        }
      }
    }

    const onTouchEnd = (ev) => {
      ignoreMouseUntil = Date.now() + 700
      if (ev.touches.length >= 2) return
      if (ev.touches.length === 1) {
        const t = ev.touches[0]
        pan = { x: t.clientX, y: t.clientY, ox: x, oy: y }
        pinch0 = null
        return
      }
      const t = ev.changedTouches[0]
      endGesture(t.clientX, t.clientY, ev.target)
    }

    const onTouchCancel = (ev) => {
      ignoreMouseUntil = Date.now() + 700
      moved = true
      const t = ev.changedTouches[0]
      endGesture(t ? t.clientX : 0, t ? t.clientY : 0, ev.target)
    }

    const onMouseDown = (ev) => {
      if (ev.button !== 0 || Date.now() < ignoreMouseUntil) return
      cancelCloseTimer()
      mouseDown = true
      moved = false
      pan = { x: ev.clientX, y: ev.clientY, ox: x, oy: y }
    }

    const onMouseMove = (ev) => {
      if (!mouseDown || !pan) return
      const dx = ev.clientX - pan.x
      const dy = ev.clientY - pan.y
      if (Math.hypot(dx, dy) > 6) moved = true
      if (scale > 1) {
        x = pan.ox + dx
        y = pan.oy + dy
        apply()
      }
    }

    const onMouseUp = (ev) => {
      if (!mouseDown) return
      endGesture(ev.clientX, ev.clientY, ev.target)
    }

    const onWheel = (ev) => {
      ev.preventDefault()
      zoomAt(ev.clientX, ev.clientY, scale * (ev.deltaY > 0 ? 0.88 : 1.14))
      apply()
    }

    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false })
    stage.addEventListener('touchend', onTouchEnd)
    stage.addEventListener('touchcancel', onTouchCancel)
    stage.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    stage.addEventListener('wheel', onWheel, { passive: false })

    lightboxCleanup = () => {
      cancelCloseTimer()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }
