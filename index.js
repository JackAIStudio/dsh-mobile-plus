/**
 * dsh-mobile-plus — independent mobile remote with text + file prompts.
 * Own routes under /mp. Does not patch @linxin666/dsh-remote-web-ui.
 */
import { AuthManager } from './lib/auth.js'
import { createPendingTracker } from './lib/events.js'
import { createDispatcher } from './lib/rpc.js'
import { setupRoutes } from './lib/routes.js'

export const name = 'dsh-mobile-plus'
export const inject = ['webServer', 'apiProxy', 'commands', 'agents']

export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false
  if (!enabled) return

  const auth = new AuthManager(config)
  const pendingTracker = createPendingTracker()
  const dispatch = createDispatcher(ctx, pendingTracker)

  ctx.effect(() => {
    return setupRoutes(ctx, auth, pendingTracker, dispatch)
  }, 'dsh-mobile-plus: routes')

  ctx.effect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const frames = ctx.apiProxy.events.mux(
          { rpcId: `mp-pending-${Date.now().toString(36)}`, payload: {} },
          controller.signal,
        )
        for await (const frame of frames) pendingTracker.onFrame(frame)
      } catch {
        /* aborted or stream ended */
      }
    })()
    return () => controller.abort()
  }, 'dsh-mobile-plus: pending mux')
}
