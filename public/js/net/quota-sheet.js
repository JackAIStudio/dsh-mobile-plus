/**
 * Quota and balance details bottom sheet.
 */
import { state, quota } from '../state/state.js'
import { el } from '../utils/dom.js'
import { formatMoney } from '../utils/time.js'
import { closeSheet, syncSheetPortal } from '../ui/sheets/portal.js'
import {
  deepseekView,
  grokView,
  grokWindowLabel,
  formatQuotaClock,
  formatQuotaStamp,
  loadQuota,
  patchQuotaBarInDom,
} from './quota.js'

export function pinQuotaButton(providerKey, label) {
  const isPinned = (state.pinnedQuota || 'auto') === providerKey
  return el('button', {
    type: 'button',
    class: `quota-pin-btn${isPinned ? ' is-active' : ''}`,
    'aria-label': isPinned ? `当前已在顶栏显示 ${label}` : `固定 ${label} 到顶栏显示`,
    onclick: () => {
      state.pinnedQuota = isPinned ? 'auto' : providerKey
      try { localStorage.setItem('dsh-mp-pinned-quota', state.pinnedQuota) } catch {}
      patchQuotaBarInDom()
      syncSheetPortal(true)
    },
  }, [isPinned ? '★ 顶栏显示中' : '☆ 固定到顶栏'])
}

export function quotaSheet() {
  const ds = deepseekView()
  const gk = grokView()
  const dsBody = !ds
    ? el('div', { class: 'quota-section' }, [
        el('div', { class: 'quota-section-head' }, [
          el('span', { class: 'quota-section-title' }, ['DeepSeek']),
        ]),
        el('p', { class: 'quota-hint' }, ['未安装余额插件，或本机暂不可查。']),
      ])
    : el('div', { class: 'quota-section' }, [
        el('div', { class: 'quota-section-head' }, [
          el('span', { class: 'quota-section-title' }, ['DeepSeek 余额']),
          pinQuotaButton('deepseek', 'DeepSeek 余额'),
        ]),
        el('p', { class: `quota-hero${ds.kind === 'warn' ? ' is-warn' : ds.kind === 'error' ? ' is-error' : ''}` }, [ds.amount]),
        ds.primary
          ? el('p', { class: 'quota-meta' }, [
              `充值 ${formatMoney(ds.primary.currency, ds.primary.toppedUp)} · 赠送 ${formatMoney(ds.primary.currency, ds.primary.granted)}`,
            ])
          : null,
        ds.fetchedAt ? el('p', { class: 'quota-hint' }, [`更新于 ${formatQuotaClock(ds.fetchedAt)}`]) : null,
        ds.available === false ? el('p', { class: 'quota-error' }, ['账号当前不可用']) : null,
        ds.error ? el('p', { class: 'quota-error' }, [ds.error]) : null,
      ])
  const products = (gk && gk.usage && Array.isArray(gk.usage.windows) ? gk.usage.windows : [])
    .filter((row) => row.id !== 'SuperGrok' && row.id !== 'weekly')
  const productLine = products.length
    ? products.map((row) => `${grokWindowLabel(row.id)} ${row.used}%`).join(' · ')
    : ''
  const resetAt = gk && gk.usage && gk.usage.windows && gk.usage.windows[0] && gk.usage.windows[0].resetsAt
  const gkBody = !gk
    ? el('div', { class: 'quota-section' }, [
        el('div', { class: 'quota-section-head' }, [
          el('span', { class: 'quota-section-title' }, ['Grok']),
        ]),
        el('p', { class: 'quota-hint' }, ['未登录 Grok，或本机暂不可查。']),
      ])
    : el('div', { class: 'quota-section' }, [
        el('div', { class: 'quota-section-head' }, [
          el('span', { class: 'quota-section-title' }, ['Grok 已使用额度']),
          pinQuotaButton('grok', 'Grok 额度'),
        ]),
        el('p', { class: `quota-hero${gk.kind === 'warn' ? ' is-warn' : gk.kind === 'alert' || gk.kind === 'error' ? ' is-alert' : ''}` }, [gk.amount]),
        gk.remaining !== undefined ? el('p', { class: 'quota-meta' }, [`还剩 ${gk.remaining}%`]) : null,
        productLine ? el('p', { class: 'quota-meta' }, [productLine]) : null,
        resetAt ? el('p', { class: 'quota-hint' }, [`重置 ${formatQuotaStamp(resetAt)}`]) : null,
        gk.usage && gk.usage.fetchedAt ? el('p', { class: 'quota-hint' }, [`更新于 ${formatQuotaClock(gk.usage.fetchedAt)}`]) : null,
        gk.error ? el('p', { class: 'quota-error' }, [gk.error]) : null,
      ])
  return el('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }, [
    el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '账户额度', onclick: (ev) => { ev.stopPropagation() } }, [
      el('div', { class: 'sheet-handle' }),
      el('div', { class: 'sheet-title quota-sheet-title' }, [
        el('span', null, ['账户额度']),
        el('button', {
          type: 'button',
          class: 'quota-refresh',
          disabled: quota.status === 'loading',
          onclick: () => { void loadQuota(true) },
        }, [quota.status === 'loading' ? '刷新中…' : '刷新']),
      ]),
      el('p', { class: 'sheet-hint', style: 'padding: 0 16px 8px; margin: 0;' }, ['提示：点击卡片右上角「固定到顶栏」，可自选将该账户余额显示在顶部胶囊。']),
      el('div', { class: 'sheet-body' }, [dsBody, gkBody]),
    ]),
  ])
}
