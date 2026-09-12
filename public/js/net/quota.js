/**
 * Quota and balance tracking for DeepSeek, Grok, and Gemini.
 */
import { state, chat, quota, runtime, QUOTA_DEBOUNCE_MS } from '../state/state.js'
import { el } from '../utils/dom.js'
import { headerIcon } from '../ui/theme.js'
import { formatMoney, formatQuotaClock, formatQuotaStamp } from '../utils/time.js'
import { GEMINI_ICON, geminiView } from './quota-gemini.js'
import { call } from './rpc.js'
import { syncSheetPortal } from '../ui/sheets/portal.js'

export { formatQuotaClock, formatQuotaStamp } from '../utils/time.js'
export { GEMINI_ICON, geminiView } from './quota-gemini.js'

const WHALE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15c2.5 0 4-2 6-2s3.5 2 6 2 4-2 6-2"/><path d="M12 3c-4.5 0-8 3.5-8 8 0 2 .5 3.5 1.5 5"/><path d="M20 11c0-4.5-3.5-8-8-8"/></svg>'
const GROK_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'

export function pickPrimaryBalance(balances) {
  if (!Array.isArray(balances) || balances.length === 0) return null
  return balances.find((row) => row.currency === 'CNY')
    || balances.find((row) => row.currency === 'USD')
    || balances[0]
    || null
}

export function grokUsedPercent(usage) {
  if (!usage || !Array.isArray(usage.windows)) return undefined
  const total = usage.windows.find((row) => row.id === 'SuperGrok' || row.id === 'weekly')
  if (total && total.unit === 'percent') return total.used
  const products = usage.windows.filter((row) => row.id !== 'SuperGrok' && row.id !== 'weekly')
  if (products.length > 0 && products.every((row) => row.unit === 'percent')) {
    return Math.min(100, Math.round(products.reduce((sum, row) => sum + row.used, 0) * 10) / 10)
  }
  return undefined
}

export function grokRemainingPercent(usage) {
  const used = grokUsedPercent(usage)
  if (used === undefined) return undefined
  return Math.max(0, Math.round((100 - used) * 10) / 10)
}

export function grokWindowLabel(id) {
  if (id === 'SuperGrok' || id === 'weekly') return 'SuperGrok'
  if (id === 'GrokBuild') return 'Build'
  if (id === 'GrokImagine') return 'Imagine'
  if (id === 'GrokAppBuilder') return 'App Builder'
  return id
}

export function deepseekView() {
  const row = quota.deepseek
  if (!row || row.present === false) return null
  const primary = pickPrimaryBalance(row.balances)
  const loading = quota.status === 'loading'
  if (primary) {
    const low = primary.currency === 'USD' ? primary.total < 1 : primary.total < 5
    return {
      amount: formatMoney(primary.currency, primary.total),
      kind: low ? 'warn' : 'ready',
      loading,
      primary,
      available: row.available !== false,
      fetchedAt: row.fetchedAt,
      balances: row.balances,
    }
  }
  if (row.ok === false) {
    return {
      amount: row.code === 'missing-key' ? '未配置' : '查不到',
      kind: row.code === 'missing-key' ? 'muted' : 'error',
      loading,
      error: row.error,
      code: row.code,
    }
  }
  if (quota.status === 'ready') return { amount: '无余额', kind: 'muted', loading }
  return { amount: '查询中', kind: 'muted', loading: true }
}

export function grokView() {
  const row = quota.grok
  if (!row || row.present === false) return null
  if (row.status === 'logged-out' || row.status === 'unsupported') return null
  const remaining = grokRemainingPercent(row.usage)
  const used = grokUsedPercent(row.usage)
  const loading = quota.status === 'loading'
  if (remaining === undefined) {
    if (row.ok === false) return { amount: '查不到', kind: 'error', loading, error: row.error }
    return null
  }
  const kind = remaining <= 5 ? 'alert' : remaining <= 20 ? 'warn' : 'ready'
  return {
    amount: `${used}% 已使用`,
    remaining,
    used,
    kind,
    loading,
    usage: row.usage,
  }
}

export function quotaSummary() {
  const parts = []
  const ds = deepseekView()
  const gk = grokView()
  const gm = geminiView()
  if (ds) parts.push(`DeepSeek ${ds.amount}`)
  if (gk) parts.push(`Grok ${gk.amount}`)
  if (gm) parts.push(`Gemini ${gm.amount}`)
  return parts.length ? parts.join(' · ') : '点击查询本机额度'
}

export function patchQuotaBarInDom() {
  if (typeof document === 'undefined') return
  const existing = document.querySelector('.mobile-quota-capsule')
  const newBar = renderQuotaBar()
  if (existing && newBar) {
    existing.replaceWith(newBar)
  } else if (!existing && newBar) {
    const actions = document.querySelector('.mobile-header-actions')
    if (actions) actions.prepend(newBar)
  } else if (existing && !newBar) {
    existing.remove()
  }
}

export function renderQuotaIfVisible() {
  patchQuotaBarInDom()
  if (state.sheet === 'quota') {
    syncSheetPortal(true)
  }
}

export function loadQuota(force) {
  if (quota.inFlight) return quota.inFlight
  if (!force && quota.lastFetchAt > 0 && Date.now() - quota.lastFetchAt < QUOTA_DEBOUNCE_MS && quota.status === 'ready') {
    return Promise.resolve()
  }
  const hadSnapshot = quota.status === 'ready'
  quota.status = 'loading'
  if (hadSnapshot && force) renderQuotaIfVisible()
  quota.inFlight = call('quota.read', force ? { force: true } : {}).then((value) => {
    quota.inFlight = null
    quota.lastFetchAt = Date.now()
    quota.deepseek = value && value.deepseek ? value.deepseek : null
    quota.grok = value && value.grok ? value.grok : null
    quota.gemini = value && value.gemini ? value.gemini : null
    quota.status = 'ready'
    renderQuotaIfVisible()
  }, () => {
    quota.inFlight = null
    quota.lastFetchAt = Date.now()
    quota.status = 'ready'
    renderQuotaIfVisible()
  })
  return quota.inFlight
}

export function openQuotaSheet() {
  if (state.sheet === 'settings') state.sheetReturn = 'settings'
  state.sheet = 'quota'
  syncSheetPortal()
  void loadQuota(false)
}

export function closeQuotaSheet() {
  state.sheet = state.sheetReturn || null
  state.sheetReturn = null
  syncSheetPortal()
}

export function resolveModelQuotaChannel(selection) {
  if (!selection || typeof selection !== 'object') return null
  const provider = String(selection.provider || '').toLowerCase()
  const model = String(selection.model || '').toLowerCase()

  if (provider.includes('deepseek') || model.includes('deepseek')) {
    return 'deepseek'
  }
  if (provider.includes('gemini') || model.includes('gemini')) {
    return 'gemini'
  }
  if (provider.includes('grok') || model.includes('grok')) {
    return 'grok'
  }
  return null
}

export function activeContextQuotaTarget() {
  const pinned = state.pinnedQuota || 'auto'
  if (pinned !== 'auto') {
    return { channel: pinned, reason: 'pinned' }
  }

  // Auto 智能跟随：
  // 1. 会话内：优先跟随当前会话实际使用的模型
  if (state.view === 'chat') {
    const sessionModel = chat.currentModel
      || state.session?.projections?.values?.modelSelection?.next
      || state.session?.projections?.values?.modelSelection?.lastUsed
    const channel = resolveModelQuotaChannel(sessionModel)
    if (channel) {
      return { channel, reason: 'chat', model: sessionModel }
    }
  }

  // 2. 会话区外（工作区列表/会话列表页）：对标新建会话默认模型
  const defModel = state.defaultModel
  const defChannel = resolveModelQuotaChannel(defModel)
  if (defChannel) {
    return { channel: defChannel, reason: state.view === 'chat' ? 'fallback-default' : 'default', model: defModel }
  }

  return { channel: 'auto', reason: 'fallback' }
}

export function renderQuotaBar() {
  const ds = deepseekView()
  const gk = grokView()
  const gm = geminiView()
  if (!ds && !gk && !gm) return null

  const target = activeContextQuotaTarget()
  let activeView = null
  let displayIcon = WHALE_ICON
  let label = '额度'
  let targetDesc = ''

  if (target.channel === 'gemini' && gm && gm.amount && gm.amount !== '查不到') {
    activeView = gm
    displayIcon = GEMINI_ICON
    label = gm.capsuleLabel || gm.amount
  } else if (target.channel === 'grok' && gk && gk.amount && gk.amount !== '查不到') {
    activeView = gk
    displayIcon = GROK_ICON
    label = gk.amount.includes('已使用') ? gk.amount.replace('已使用', '').trim() : gk.amount
  } else if (target.channel === 'deepseek' && ds && ds.amount && ds.amount !== '查不到' && ds.amount !== '未配置') {
    activeView = ds
    displayIcon = WHALE_ICON
    label = ds.amount
  } else {
    // 兜底降级：目标无额度或未识别时按可用额度展示
    if (ds && ds.amount && ds.amount !== '查不到' && ds.amount !== '未配置') {
      activeView = ds
      displayIcon = WHALE_ICON
      label = ds.amount
    } else if (gk && gk.amount && gk.amount !== '查不到') {
      activeView = gk
      displayIcon = GROK_ICON
      label = gk.amount.includes('已使用') ? gk.amount.replace('已使用', '').trim() : gk.amount
    } else if (gm && gm.amount && gm.amount !== '查不到') {
      activeView = gm
      displayIcon = GEMINI_ICON
      label = gm.capsuleLabel || gm.amount
    } else {
      label = '额度'
      displayIcon = WHALE_ICON
    }
  }

  if (target.reason === 'chat') {
    targetDesc = `【当前会话: ${target.model?.model || target.channel}】`
  } else if (target.reason === 'default') {
    targetDesc = `【新建默认: ${target.model?.model || target.channel}】`
  } else if (target.reason === 'pinned') {
    targetDesc = `【已固定: ${target.channel}】`
  }

  const hasAlert = ds?.kind === 'alert' || ds?.kind === 'error' || gk?.kind === 'alert' || gk?.kind === 'error' || gm?.kind === 'alert' || gm?.kind === 'error'
  const hasWarn = ds?.kind === 'warn' || gk?.kind === 'warn' || gm?.kind === 'warn'
  const isLoading = ds?.loading || gk?.loading || gm?.loading

  const tooltip = `${targetDesc ? `${targetDesc} ` : ''}${quotaSummary()}，点击切换关注与查看详情`

  return el('button', {
    type: 'button',
    class: [
      'mobile-quota-capsule',
      isLoading ? 'is-loading' : '',
      hasAlert ? 'is-alert' : '',
      hasWarn && !hasAlert ? 'is-warn' : '',
    ].filter(Boolean).join(' '),
    title: tooltip,
    'aria-label': tooltip,
    onclick: () => openQuotaSheet(),
  }, [
    headerIcon(displayIcon),
    el('span', { class: 'mobile-quota-text' }, [label]),
    hasAlert || hasWarn ? el('span', { class: 'mobile-quota-dot', 'aria-hidden': 'true' }) : null,
  ])
}
