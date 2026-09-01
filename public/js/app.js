/**
 * dsh-mobile-plus — mobile application entry point.
 */
import { state, runtime } from './state/state.js'
import { pairStatus, acceptPair } from './net/pair.js'
import { enterApp, render } from './ui/views/render.js'
import { applyTheme } from './ui/theme.js'
import { installOverscrollLock, pinViewport } from './utils/scroll.js'
import { restoreRoute, applyRoute, parseRoute } from './state/route.js'

// Global window and document event listeners
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (runtime.ignoringPop) return
    void applyRoute(parseRoute(location.hash), { mode: 'replace' })
  })
  window.addEventListener('load', () => { void boot() })
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onForeground()
  })
  window.addEventListener('focus', onForeground)
  window.addEventListener('pageshow', onForeground)
}

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
      deferredInstallPrompt = event
    })
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null
      if (state.sheet === 'pwa') {
        state.sheet = null
        render()
      }
    })
  }

export function onForeground() {
    if (mux) mux.wake()
    if (host) host.wake()
    void loadQuota(false)
    void refreshLiveSnapshot()
    if (state.view === 'chat' && state.session) {
      if (mux) mux.nudge(state.session.sessionId)
      void refreshPending()
    }
  }
