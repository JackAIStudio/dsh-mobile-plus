/**
 * Notifications and audio chime for task completion.
 * The chime is synthesized with WebAudio (no asset file needed); iOS requires
 * a prior user gesture (settings toggle or preview button) to unlock audio.
 */
import { state, runtime } from '../state/state.js'
import { call } from '../net/rpc.js'
import { showToast } from './toast.js'
import { navigateToSession } from '../state/route.js'

const DEDUPE_MS = 8000
const lastNotifiedAt = new Map()

let audioCtx = null

function ensureAudioContext() {
  if (audioCtx !== null) return audioCtx
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  try { audioCtx = new Ctor() } catch { audioCtx = null }
  return audioCtx
}

/** Call from a user gesture so iOS allows later playback without making any sound. */
export function unlockAudio() {
  const ctx = ensureAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  if (runtime.audioUnlocked) return
  try {
    const buffer = ctx.createBuffer(1, 1, 22050)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
    runtime.audioUnlocked = true
  } catch { /* ignore */ }
}

/** Unlock WebAudio on the first user interaction anywhere on screen. */
export function installAudioUnlockOnGesture() {
  if (typeof window === 'undefined') return
  const unlock = () => {
    unlockAudio()
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('touchstart', unlock, true)
    window.removeEventListener('click', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true })
  window.addEventListener('touchstart', unlock, { capture: true, passive: true })
  window.addEventListener('click', unlock, { capture: true, passive: true })
}

/** Two-note "ding-dong" chime; returns true when playback started. */
export async function playChime() {
  const ctx = ensureAudioContext()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {})
    }
    const notes = [[880, 0], [1318.5, 0.16]]
    const baseTime = ctx.currentTime
    for (const [freq, offset] of notes) {
      const t0 = baseTime + offset
      for (const [mult, peak] of [[1, 0.4], [2, 0.08]]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq * mult
        gain.gain.setValueAtTime(0.0001, t0)
        gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + 0.55)
      }
    }
    return true
  } catch (err) {
    console.error('Chime error', err)
    return false
  }
}

/** Show the system notification through the PWA service worker with fallback. */
export function showTaskDoneNotification(body, sessionId) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  const title = '任务完成'
  const targetUrl = sessionId ? `/mp/#/s/${encodeURIComponent(sessionId)}` : '/mp/'
  const options = {
    body: body || '一个对话任务已完成',
    icon: '/mp/icon.png',
    tag: sessionId ? `task-done-${sessionId}` : 'task-done',
    renotify: true,
    data: {
      sessionId: sessionId || '',
      url: targetUrl,
    },
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((registration) => {
      registration.showNotification(title, options)
    }).catch(() => {
      try {
        const notif = new Notification(title, options)
        if (sessionId) notif.onclick = () => { window.focus(); void navigateToSession(sessionId) }
      } catch {}
    })
    return true
  }
  try {
    const notif = new Notification(title, options)
    if (sessionId) notif.onclick = () => { window.focus(); void navigateToSession(sessionId) }
    return true
  } catch {
    return false
  }
}

function sessionTitle(sessionId) {
  if (state.session?.sessionId === sessionId && state.session?.title) return state.session.title
  const item = state.sessions.find((row) => row.sessionId === sessionId)
  return item?.title || '会话'
}

/**
 * Completion entry point: chime + system notification, deduped per session so
 * the SSE status frame, turn/end frame and snapshot poll never stack.
 */
export function triggerTaskDoneNotification(title, sessionId) {
  if (!runtime.notificationsEnabled && !runtime.soundEnabled) return
  if (typeof sessionId === 'string') {
    const now = Date.now()
    if (now - (lastNotifiedAt.get(sessionId) || 0) < DEDUPE_MS) return
    lastNotifiedAt.set(sessionId, now)
  }
  const text = title ? `${title} 已完成` : '一个对话任务已完成'
  if (runtime.soundEnabled) {
    void playChime()
  }
  if (runtime.notificationsEnabled) {
    showTaskDoneNotification(text, sessionId)
  }
}

/**
 * Edge detector for host frames: call right after applySessionLive, passing
 * whether the session was running before the frame (hadRunning === true).
 */
export function notifyIfCompleted(frame, hadRunning) {
  if (hadRunning !== true) return
  if (!frame || typeof frame.sessionId !== 'string') return
  const isStatus = frame.type === 'host/session-status' && frame.running !== true
  const isTurnEnd = frame.type === 'session/event' && frame.event?.type === 'turn/end'
  if (!isStatus && !isTurnEnd) return
  const eventTime = frame.event?.time || frame.time
  if (typeof eventTime === 'number' && eventTime > 0 && Date.now() - eventTime > 15_000) return
  const row = runtime.sessionLive.get(frame.sessionId)
  if (row && row.running === true) return
  triggerTaskDoneNotification(sessionTitle(frame.sessionId), frame.sessionId)
}

/** User-initiated preview from the settings sheet (the gesture unlocks audio). */
export async function previewNotification() {
  unlockAudio()
  if (runtime.soundEnabled) {
    void playChime()
  }
  if (runtime.notificationsEnabled) {
    if (typeof Notification === 'undefined') {
      alert('当前环境不支持系统横幅通知（需 HTTPS 访问或添加到主屏幕 PWA）。')
      return
    }
    let permission = Notification.permission
    if (permission === 'default') {
      try { permission = await Notification.requestPermission() } catch { permission = 'denied' }
    }
    if (permission === 'granted' && navigator.serviceWorker) {
      try {
        const registration = await navigator.serviceWorker.ready
        await registration.showNotification('通知试听', {
          body: '这是一条测试通知：任务完成时会收到同样的通知',
          icon: '/mp/icon.png',
          tag: 'task-done-test',
          renotify: true,
        })
      } catch (err) {
        console.error('Preview notification error', err)
      }
    }
  } else if (!runtime.soundEnabled) {
    showToast('提示音与通知均已关闭', 2000)
  }
}

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function syncPushSubscription() {
  if (typeof window === 'undefined' || !navigator.serviceWorker || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted' || !runtime.notificationsEnabled) return
  try {
    const reg = await navigator.serviceWorker.ready
    if (!reg.pushManager) return
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      let publicKey = ''
      try {
        const resp = await call('push.key', {})
        publicKey = resp.publicKey
      } catch {
        const res = await fetch('/mp/api/push/key')
        const data = await res.json()
        publicKey = data.publicKey
      }
      if (!publicKey) return
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey),
      })
    }
    if (sub) {
      try {
        await call('push.subscribe', { subscription: sub })
      } catch {
        await fetch('/mp/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub }),
        })
      }
    }
  } catch (err) {
    console.warn('[WebPush] Subscription sync skipped:', err)
  }
}

export async function unsubscribePush() {
  if (typeof window === 'undefined' || !navigator.serviceWorker) return
  try {
    const reg = await navigator.serviceWorker.ready
    if (!reg.pushManager) return
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      try {
        await call('push.unsubscribe', { endpoint: sub.endpoint })
      } catch {
        await fetch('/mp/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
      }
      await sub.unsubscribe().catch(() => {})
    }
  } catch {}
}
