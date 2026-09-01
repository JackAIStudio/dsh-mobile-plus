/**
 * RPC caller and fetch utilities.
 */
import { runtime } from '../state/state.js'

export function rpcId() {
    return `${Date.now().toString(36)}-${++rpcN}`
  }

export async function call(method, payload) {
    const id = rpcId()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_OVERRIDES[method] || RPC_TIMEOUT_MS)
    let res
    try {
      res = await fetch(`/mp/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload }),
        signal: controller.signal,
      })
    } catch (err) {
      throw controller.signal.aborted
        ? new Error('请求超时：电脑端 dsh 长时间未响应，请确认主机在线后重试。')
        : (err instanceof Error ? err : new Error(String(err)))
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 403) {
      // 403 有两种（读 body 区分，避免一律显示 "unpaired"）：
      // - error.code === 'forbidden'：方法不在宿主端白名单里 —— 宿主端插件
      //   还是旧版本（老插件 staleHostHint 的同款提示）
      // - 其它：此设备配对失效
      let code
      try {
        const body = await res.json()
        code = body?.error?.code
      } catch { /* non-JSON body */ }
      const err = new Error(code === 'forbidden'
        ? '宿主端插件可能是旧版本：请重启 dsh web 后再试。'
        : '此设备未配对：请在电脑端重新生成配对链接。')
      err.code = 'unpaired'
      throw err
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const envelope = await res.json()
    if (envelope?.result?.ok === true) return envelope.result.value
    throw new Error(envelope?.result?.error?.message || '请求失败')
  }

export async function timedFetch(url, options = {}, timeoutMs = 15 * 1000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { ...options, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
