/**
 * dsh-mobile-plus — independent mobile remote with text + file prompts.
 * Own routes under /mp. Does not patch @linxin666/dsh-remote-web-ui.
 */
import { AuthManager } from './lib/auth.js'
import { LanBridge } from './lib/lan-bridge.js'
import { RelayBridge } from './lib/relay-bridge.js'
import { createPendingTracker } from './lib/events.js'
import { createLiveMuxStream } from './lib/live-stream.js'
import { createDispatcher } from './lib/rpc.js'
import { setupRoutes } from './lib/routes.js'
import { setupPersistenceHook } from './lib/web-push.js'
import { svc } from './lib/utils.js'

export const name = 'dsh-mobile-plus'
export const inject = ['webServer', 'commands', 'agents']

export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false
  if (!enabled) return

  const auth = new AuthManager(config)
  const pendingTracker = createPendingTracker()
  const dispatch = createDispatcher(ctx, pendingTracker)

  ctx.effect(() => {
    const port = typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 3080
    const bridge = new LanBridge(port, 3088)
    void bridge.start().then((boundPort) => {
      if (boundPort) auth.lanPort = boundPort
    })
    return () => bridge.stop()
  }, 'dsh-mobile-plus: lan bridge')

  let relayInstance = null

  ctx.effect(() => {
    const port = typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 3080
    relayInstance = new RelayBridge(port, config)
    if (relayInstance.publicBaseUrl && !auth.publicBaseUrl) {
      auth.publicBaseUrl = relayInstance.publicBaseUrl
      try {
        auth.publicHost = new URL(auth.publicBaseUrl).host
      } catch {}
    }
    relayInstance.start()
    return () => {
      if (relayInstance) relayInstance.stop()
      relayInstance = null
    }
  }, 'dsh-mobile-plus: relay bridge')

  ctx.effect(() => {
    return setupRoutes(ctx, auth, pendingTracker, dispatch, () => relayInstance)
  }, 'dsh-mobile-plus: routes')

  setupPersistenceHook(ctx)

  ctx.effect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const proxy = svc(ctx, 'apiProxy')
        const frames = proxy?.events?.mux
          ? proxy.events.mux({ rpcId: `mp-pending-${Date.now().toString(36)}`, payload: {} }, controller.signal)
          : createLiveMuxStream(ctx, controller.signal)
        for await (const frame of frames) pendingTracker.onFrame(frame)
      } catch {
        /* aborted or stream ended */
      }
    })()
    return () => controller.abort()
  }, 'dsh-mobile-plus: pending mux')
}
