/**
 * Stream-driven chat re-render.
 *
 * Two things keep a streamed reply cheap to draw and calm to watch:
 * unchanged nodes are moved forward instead of rebuilt (node-reuse.js), and the
 * page is never torn down while the reader is moving through it — swapping the
 * DOM under a moving finger reads as the page refreshing mid-scroll.
 */
import { render } from './render.js'
import { beginNodeReuse, endNodeReuse } from './node-reuse.js'
import { chatGestureActive } from '../../utils/scroll.js'
import { throttleTrailing } from '../../utils/frame-throttle.js'

const GESTURE_RETRY_MS = 150

function draw() {
  if (chatGestureActive()) {
    setTimeout(draw, GESTURE_RETRY_MS)
    return
  }
  beginNodeReuse()
  try {
    render()
  } finally {
    endNodeReuse()
  }
}

export const renderLive = throttleTrailing(draw, 100)
