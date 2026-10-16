/**
 * Soft-keyboard geometry for Android Chromium shells.
 *
 * Most shells shrink the layout or the visual viewport when the keyboard
 * opens, which `pinViewport()` already follows. Some — Xiaomi's PWA window,
 * for one — draw the keyboard straight over the WebView and report nothing at
 * all, leaving the composer underneath the keys. Chromium's virtualKeyboard
 * API is the only signal there: in overlay mode the browser stops resizing on
 * its own and hands over the keyboard rect instead, which the caller subtracts
 * from the pinned body height.
 */
let overlay = false
let armed = false
let probeEl = null
let keyboardFocused = false
let silentShell = false
let keyboardHidden = false

const RATIO_KEY = 'mp.kbInsetRatio'
const DEFAULT_RATIO = 0.42
const MIN_RATIO = 0.2
const MAX_RATIO = 0.7
let liveRatio = null

/** Chromium also exposes the same geometry as a CSS environment variable;
    some shells fill that in even when they never push geometrychange. */
function envInsetPx() {
  if (!probeEl || !probeEl.isConnected) {
    probeEl = document.createElement('div')
    probeEl.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:env(keyboard-inset-height,0px);pointer-events:none'
    document.body.appendChild(probeEl)
  }
  const height = Math.round(probeEl.getBoundingClientRect().height)
  return height > 0 ? height : 0
}

/** Switch the keyboard between browser-managed and app-managed geometry. */
export function setVirtualKeyboardMode(on) {
  const vk = window.navigator.virtualKeyboard
  if (!vk) return false
  try {
    vk.overlaysContent = !!on
  } catch {
    return false
  }
  overlay = !!on
  if (!on) armed = false
  return true
}

/** Height of the soft keyboard in CSS px, 0 when closed or unknown. */
export function keyboardInsetPx() {
  if (!overlay) return 0
  const vk = window.navigator.virtualKeyboard
  const rect = vk && vk.boundingRect
  if (rect && rect.height > 0) return Math.round(rect.height)
  return envInsetPx()
}

/** True once this shell was caught hiding the keyboard from the viewport
    without ever reporting its geometry (Xiaomi's PWA window does exactly
    that), so nothing but an estimate is available. */
export function shellIgnoresKeyboard() {
  return silentShell
}

/** Share of the viewport the soft keyboard covers on this device. Learned
    from a shipped default, then user-tunable — keyboards differ by skin,
    language row count and floating toolbars. */
export function keyboardInsetRatio() {
  if (liveRatio !== null) return liveRatio
  try {
    const raw = Number(window.localStorage.getItem(RATIO_KEY))
    if (Number.isFinite(raw) && raw >= MIN_RATIO && raw <= MAX_RATIO) return raw
  } catch {
    /* private mode: fall through to the default */
  }
  return DEFAULT_RATIO
}

/** `persist: false` keeps dragging smooth — one storage write on release. */
export function setKeyboardInsetRatio(value, persist = true) {
  const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
  liveRatio = clamped
  if (persist) {
    try {
      window.localStorage.setItem(RATIO_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }
  return clamped
}

/** True once this device was calibrated, so the fit bar can stay out of the way. */
export function hasKeyboardInsetRatio() {
  try {
    return window.localStorage.getItem(RATIO_KEY) !== null
  } catch {
    return false
  }
}

export function clearKeyboardInsetRatio() {
  liveRatio = null
  try {
    window.localStorage.removeItem(RATIO_KEY)
  } catch {
    /* ignore */
  }
}

/** Last-resort inset for shells that report nothing at all. Only phones can
    have a soft keyboard worth lifting for, and only while a field is focused. */
export function estimatedKeyboardInset() {
  if (!silentShell || !keyboardFocused || keyboardHidden) return 0
  if (!window.navigator.virtualKeyboard) return 0
  // Touch-only device: a coarse pointer alone also matches touch laptops,
  // which have no soft keyboard to lift for.
  if (!window.matchMedia('(pointer: coarse)').matches) return 0
  if (window.matchMedia('(hover: hover)').matches) return 0
  const inset = Math.round(window.innerHeight * keyboardInsetRatio())
  return inset > 120 ? inset : 0
}

/** The shell's own keyboard UI can hide the keyboard while the field keeps
    focus (Xiaomi's ▼ chevron does). Whoever can tell reports it here, so the
    composer stops being lifted off an empty screen. */
export function markKeyboardHidden() {
  if (keyboardHidden) return
  keyboardHidden = true
  window.dispatchEvent(new Event('resize'))
}

export function markKeyboardShown() {
  if (!keyboardHidden) return
  keyboardHidden = false
  window.dispatchEvent(new Event('resize'))
}

export function isTextEntry(node) {
  if (!node || node.nodeType !== 1) return false
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable === true
}

/** Viewport size now, for comparing against the size a field saw at focus. */
function viewportNow() {
  const vv = window.visualViewport
  return {
    height: window.innerHeight,
    visual: vv ? vv.height : window.innerHeight,
    top: vv ? vv.offsetTop : 0,
  }
}

/** A shell that resizes the viewport for the keyboard keeps its own, more
    accurate signal; only a shell that ignored the keyboard entirely needs to
    be taken over. Measured against the size at focus, never against a fixed
    assumption: resize-to-content shells shrink both heights at once. */
function armIfKeyboardIgnored(baseline) {
  if (armed || overlay) return false
  if (!window.navigator.virtualKeyboard) return false
  const now = viewportNow()
  const ignored =
    baseline.height - now.height < 80 &&
    baseline.visual - now.visual < 80 &&
    now.top <= baseline.top
  if (!ignored) return false
  silentShell = true
  // Everyone waiting on "is this an overlay shell?" can stop guessing now.
  window.dispatchEvent(new Event('mp-keyboard-silent'))
  if (!setVirtualKeyboardMode(true)) return false
  armed = true
  return true
}

/** Report keyboard geometry through `onChange`, and run `onChange` once more
    when an overlay shell is taken over mid-focus. */
export function installKeyboardInsetProbe(onChange) {
  const vk = window.navigator.virtualKeyboard
  if (vk) {
    try {
      vk.addEventListener('geometrychange', onChange)
    } catch {
      /* no geometry reporting here — the viewport listeners must carry it */
    }
  }
  let poll = 0
  const startPoll = () => {
    if (poll) return
    let last = -1
    const step = () => {
      const inset = envInsetPx()
      if (inset !== last) {
        last = inset
        onChange()
      }
      poll = setTimeout(step, 250)
    }
    poll = setTimeout(step, 250)
  }
  const stopPoll = () => {
    if (poll) clearTimeout(poll)
    poll = 0
  }
  window.addEventListener('focusin', (ev) => {
    if (!isTextEntry(ev.target)) return
    keyboardFocused = true
    const baseline = viewportNow()
    const arm = () => {
      if (armIfKeyboardIgnored(baseline)) onChange()
    }
    // Give the shell a beat to prove it resizes before taking it over.
    setTimeout(arm, 400)
    setTimeout(arm, 900)
    // The env() probe reads 0 until overlay mode is on, so this is free.
    startPoll()
  })
  window.addEventListener('focusout', () => {
    keyboardFocused = false
    setTimeout(stopPoll, 1200)
  })
}
