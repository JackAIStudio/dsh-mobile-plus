/**
 * Lightweight mobile toast notification.
 */
let toastTimer = null

export function showToast(message, duration = 1800, onClick = null) {
  if (typeof document === 'undefined') return
  let container = document.getElementById('mobile-toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'mobile-toast-container'
    container.className = 'mobile-toast-container'
    document.body.appendChild(container)
  }
  container.textContent = String(message || '')
  container.classList.add('is-visible')

  if (typeof onClick === 'function') {
    container.style.cursor = 'pointer'
    container.onclick = () => {
      try { onClick() } catch {}
      container.classList.remove('is-visible')
      if (toastTimer) {
        clearTimeout(toastTimer)
        toastTimer = null
      }
    }
  } else {
    container.style.cursor = 'default'
    container.onclick = null
  }

  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    container.classList.remove('is-visible')
    toastTimer = null
  }, duration)
}
