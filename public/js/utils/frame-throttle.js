/**
 * Collapse a burst of calls into at most one run per `minGapMs`, keeping the
 * last one — a streamed reply can deliver dozens of frames per second, and
 * each one asks for a full re-render.
 */
export function throttleTrailing(fn, minGapMs) {
  let lastRun = 0
  let timer = 0
  return (...args) => {
    const wait = minGapMs - (Date.now() - lastRun)
    if (wait <= 0) {
      lastRun = Date.now()
      fn(...args)
      return
    }
    if (timer) return
    timer = setTimeout(() => {
      timer = 0
      lastRun = Date.now()
      fn(...args)
    }, wait)
  }
}
