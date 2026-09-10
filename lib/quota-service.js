import { QUOTA_TTL_MS } from './constants.js'
import { fetchLoopbackJson } from './utils.js'

let quotaCache = { at: 0, value: null }

export async function readQuotaSnapshot(ctx, force, signal) {
  if (!force && quotaCache.value && Date.now() - quotaCache.at < QUOTA_TTL_MS) {
    return quotaCache.value
  }
  const port = ctx.webServer.port
  const [deepseek, grok, gemini] = await Promise.all([
    fetchLoopbackJson(port, '/dsh-deepseek-balance', signal),
    fetchLoopbackJson(port, '/dsh-grok-oauth/usage', signal),
    fetchLoopbackJson(port, '/gemini-oauth/api/quota', signal),
  ])
  const value = { deepseek, grok, gemini }
  quotaCache = { at: Date.now(), value }
  return value
}
