/**
 * dsh-mobile-plus — mobile application entry point.
 * Only dependency wiring and lifecycle initialization live here.
 */
import { state, runtime } from './state/state.js'
import { pairStatus, acceptPair, parsePairInput } from './net/pair.js'
import { loadQuota } from './net/quota.js'
import { refreshPending } from './net/pending.js'
import { refreshLiveSnapshot } from './ui/views/session-view.js'
import { enterApp, render } from './ui/views/render.js'
import { applyTheme } from './ui/theme.js'
import { installOverscrollLock, pinViewport } from './utils/scroll.js'
import { autosizeInput, flushComposerRender } from './chat/composer.js'
import { reloadPaired, applyRoute, parseRoute } from './state/route.js'

export async function boot() {
  state.view = 'boot'
  render()
  try {
    const paired = await pairStatus()
    if (paired) {
      await enterApp()
      return
    }
    const token = parsePairInput(window.location.href)
    if (token) {
      const message = await acceptPair(token)
      if (message) {
        state.dirError = message
      } else {
        reloadPaired()
        return
      }
    }
    state.view = 'pair'
    render()
  } catch (err) {
    state.error = String(err.message || err)
    state.view = 'error'
    render()
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export function isSecurePage() {
  return window.isSecureContext === true
}

export function isAppleMobile() {
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1
}

export function registerPwa() {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register('/mp/sw.js', { scope: '/mp/', updateViaCache: 'none' }).catch(() => {})
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    runtime.deferredInstallPrompt = event
  })
  window.addEventListener('appinstalled', () => {
    runtime.deferredInstallPrompt = null
    if (state.sheet === 'pwa') {
      state.sheet = null
      render()
    }
  })
}

export function onForeground() {
  if (runtime.mux) runtime.mux.wake()
  if (runtime.host) runtime.host.wake()
  void loadQuota(false)
  void refreshLiveSnapshot()
  if (state.view === 'chat' && state.session) {
    if (runtime.mux) runtime.mux.nudge(state.session.sessionId)
    void refreshPending()
  }
}

if (typeof window !== 'undefined') {
  applyTheme()
  pinViewport()
  installOverscrollLock()
  registerPwa()

  window.addEventListener('popstate', () => {
    if (runtime.ignoringPop) return
    if (state.view === 'boot' || state.view === 'pair') return
    const route = (history.state && history.state.mp) || parseRoute(window.location.hash)
    void applyRoute(route, { fromPopstate: true })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onForeground()
  })
  window.addEventListener('focus', onForeground)
  window.addEventListener('pageshow', onForeground)
  window.addEventListener('online', () => onForeground())

  document.addEventListener('compositionstart', (ev) => {
    const tag = ev.target && ev.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') runtime.imeComposing = true
  }, true)
  document.addEventListener('compositionend', (ev) => {
    const tag = ev.target && ev.target.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
    runtime.imeComposing = false
    if (ev.target.classList && ev.target.classList.contains('chat-input')) {
      state.draft = ev.target.value
      autosizeInput(ev.target)
    }
    flushComposerRender()
  }, true)
  document.addEventListener('focusout', (ev) => {
    const tag = ev.target && ev.target.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
    if (!runtime.imeComposing) return
    setTimeout(() => {
      if (!runtime.imeComposing) return
      runtime.imeComposing = false
      if (runtime.composerNode) state.draft = runtime.composerNode.value
      flushComposerRender()
    }, 0)
  }, true)

  render()
  void boot()
}
