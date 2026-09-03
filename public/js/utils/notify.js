/**
 * Notifications and audio chime for task completion.
 * The chime is synthesized with WebAudio (no asset file needed); iOS requires
 * a prior user gesture (settings toggle or preview button) to unlock audio.
 */
import { state, runtime } from '../state/state.js'

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

/** Call from a user gesture (toggle / preview) so iOS allows later playback. */
export function unlockAudio() {
  const ctx = ensureAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    gain.gain.value = 0.01
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.05)
    runtime.audioUnlocked = true
  } catch { /* ignore */ }
}

/** Two-note "ding-dong" chime; returns true when playback started. */
export function playChime() {
  const ctx = ensureAudioContext()
  if (!ctx) return false
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  try {
    const notes = [[880, 0], [1318.5, 0.16]]
    for (const [freq, offset] of notes) {
      const t0 = ctx.currentTime + offset
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

/** Show the system notification through the PWA service worker. */
export function showTaskDoneNotification(body) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  if (!navigator.serviceWorker) return false
  try {
    navigator.serviceWorker.ready.then((registration) => {
      registration.showNotification('任务完成', {
        body: body || '一个对话任务已完成',
        icon: '/mp/icon.png',
        tag: 'task-done',
        renotify: true,
      })
    }).catch(() => {})
    return true
  } catch (err) {
    console.error('Push error', err)
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
  if (!runtime.notificationsEnabled) return
  if (typeof sessionId === 'string') {
    const now = Date.now()
    if (now - (lastNotifiedAt.get(sessionId) || 0) < DEDUPE_MS) return
    lastNotifiedAt.set(sessionId, now)
  }
  playChime()
  showTaskDoneNotification(title ? `${title} 已完成` : '一个对话任务已完成')
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
  const row = runtime.sessionLive.get(frame.sessionId)
  if (!row || row.running !== false) return
  triggerTaskDoneNotification(sessionTitle(frame.sessionId), frame.sessionId)
}

/** User-initiated preview from the settings sheet (the gesture unlocks audio). */
export async function previewNotification() {
  unlockAudio()
  playChime()
  if (typeof Notification === 'undefined') return
  let permission = Notification.permission
  if (permission === 'default') {
    try { permission = await Notification.requestPermission() } catch { permission = 'denied' }
  }
  if (permission !== 'granted' || !navigator.serviceWorker) return
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
