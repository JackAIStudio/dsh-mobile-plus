/**
 * Quota and balance tracking for DeepSeek and Grok.
 */
import { state, quota, runtime, QUOTA_DEBOUNCE_MS } from '../state/state.js'
import { el } from '../utils/dom.js'
import { headerIcon } from '../ui/theme.js'
import { formatMoney } from '../utils/time.js'
import { call } from './rpc.js'

const WHALE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15c2.5 0 4-2 6-2s3.5 2 6 2 4-2 6-2"/><path d="M12 3c-4.5 0-8 3.5-8 8 0 2 .5 3.5 1.5 5"/><path d="M20 11c0-4.5-3.5-8-8-8"/></svg>'
const GROK_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'

export function formatQuotaClock(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ms)) return ''
  try {
    return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

export function formatQuotaStamp(iso) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (n) => String(n).padStart(2, '0')
  return `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

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
  if (ds) parts.push(`DeepSeek ${ds.amount}`)
  if (gk) parts.push(`Grok ${gk.amount}`)
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
  if (state.sheet === 'quota' && typeof runtime.syncSheetPortal === 'function') {
    runtime.syncSheetPortal(true)
  }
}

export function loadQuota(force) {
  if (quota.inFlight) return quota.inFlight
  if (!force && quota.lastFetchAt > 0 && Date.now() - quota.lastFetchAt < QUOTA_DEBOUNCE_MS && quota.status === 'ready') {
    return Promise.resolve()
  }
  const hadSnapshot = quota.status === 'ready'
  quota.status = 'loading'
  if (hadSnapshot) renderQuotaIfVisible()
  quota.inFlight = call('quota.read', force ? { force: true } : {}).then((value) => {
    quota.inFlight = null
    quota.lastFetchAt = Date.now()
    quota.deepseek = value && value.deepseek ? value.deepseek : null
    quota.grok = value && value.grok ? value.grok : null
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
  void loadQuota(true)
}

export function closeQuotaSheet() {
  state.sheet = state.sheetReturn || null
  state.sheetReturn = null
  syncSheetPortal()
}

export function renderQuotaBar() {
  const ds = deepseekView()
  const gk = grokView()
  if (!ds && !gk) return null

  const pinned = state.pinnedQuota || 'auto'
  let activeView = null
  let displayIcon = WHALE_ICON
  let label = '额度'

  if (pinned === 'grok' && gk && gk.amount && gk.amount !== '查不到') {
    activeView = gk
    displayIcon = GROK_ICON
    label = gk.amount.includes('已使用') ? gk.amount.replace('已使用', '').trim() : gk.amount
  } else if (pinned === 'deepseek' && ds && ds.amount && ds.amount !== '查不到' && ds.amount !== '未配置') {
    activeView = ds
    displayIcon = WHALE_ICON
    label = ds.amount
  } else {
    if (ds && ds.amount && ds.amount !== '查不到' && ds.amount !== '未配置') {
      activeView = ds
      displayIcon = WHALE_ICON
      label = ds.amount
    } else if (gk && gk.amount && gk.amount !== '查不到') {
      activeView = gk
      displayIcon = GROK_ICON
      label = gk.amount.includes('已使用') ? gk.amount.replace('已使用', '').trim() : gk.amount
    } else {
      label = '额度'
      displayIcon = WHALE_ICON
    }
  }

  const hasAlert = ds?.kind === 'alert' || ds?.kind === 'error' || gk?.kind === 'alert' || gk?.kind === 'error'
  const hasWarn = ds?.kind === 'warn' || gk?.kind === 'warn'
  const isLoading = ds?.loading || gk?.loading

  return el('button', {
    type: 'button',
    class: [
      'mobile-quota-capsule',
      isLoading ? 'is-loading' : '',
      hasAlert ? 'is-alert' : '',
      hasWarn && !hasAlert ? 'is-warn' : '',
    ].filter(Boolean).join(' '),
    title: `${quotaSummary()}，点击切换关注与查看详情`,
    'aria-label': `${quotaSummary()}，点击切换关注与查看详情`,
    onclick: () => openQuotaSheet(),
  }, [
    headerIcon(displayIcon),
    el('span', { class: 'mobile-quota-text' }, [label]),
    hasAlert || hasWarn ? el('span', { class: 'mobile-quota-dot', 'aria-hidden': 'true' }) : null,
  ])
}
