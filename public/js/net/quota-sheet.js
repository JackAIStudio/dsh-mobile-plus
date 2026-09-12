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
  geminiView,
  grokWindowLabel,
  formatQuotaClock,
  formatQuotaStamp,
  loadQuota,
  patchQuotaBarInDom,
  activeContextQuotaTarget,
} from './quota.js'

export function pinQuotaButton(providerKey, label) {
  const isPinned = state.pinnedQuota === providerKey
  const target = activeContextQuotaTarget()
  const isAutoActive = (state.pinnedQuota || 'auto') === 'auto' && target.channel === providerKey

  let buttonText = '☆ 固定'
  let buttonClass = 'quota-pin-btn'
  let ariaLabel = `固定 ${label} 到顶栏显示`

  if (isPinned) {
    buttonText = '★ 已固定'
    buttonClass += ' is-active'
    ariaLabel = `当前已在顶栏固定显示 ${label}，点击恢复智能跟随`
  } else if (isAutoActive) {
    const reasonText = target.reason === 'chat' ? '当前会话' : '新建默认'
    buttonText = `● 跟随中 (${reasonText})`
    buttonClass += ' is-auto-active'
    ariaLabel = `当前智能跟随此项 (${reasonText})，点击可固定锁定`
  }

  return el('button', {
    type: 'button',
    class: buttonClass,
    'aria-label': ariaLabel,
    onclick: () => {
      state.pinnedQuota = isPinned ? 'auto' : providerKey
      try { localStorage.setItem('dsh-mp-pinned-quota-v2', state.pinnedQuota) } catch {}
      patchQuotaBarInDom()
      syncSheetPortal(true)
    },
  }, [buttonText])
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
  const gm = geminiView()
  const gmBody = !gm
    ? el('div', { class: 'quota-section' }, [
        el('div', { class: 'quota-section-head' }, [
          el('span', { class: 'quota-section-title' }, ['Gemini']),
        ]),
        el('p', { class: 'quota-hint' }, ['未登录 Gemini，或本机暂不可查。']),
      ])
    : el('div', { class: 'quota-section' }, [
        el('div', { class: 'quota-section-head' }, [
          el('span', { class: 'quota-section-title' }, ['Gemini 剩余额度']),
          pinQuotaButton('gemini', 'Gemini 额度'),
        ]),
        el('p', { class: `quota-hero${gm.kind === 'warn' ? ' is-warn' : gm.kind === 'alert' || gm.kind === 'error' ? ' is-alert' : ''}` }, [gm.amount]),
        gm.geminiLine ? el('p', { class: 'quota-meta' }, [gm.geminiLine]) : null,
        gm.thirdPartyLine ? el('p', { class: 'quota-meta' }, [gm.thirdPartyLine]) : null,
        gm.resetLine ? el('p', { class: 'quota-hint' }, [gm.resetLine]) : null,
        gm.accountId ? el('p', { class: 'quota-hint' }, [`账号 ${gm.accountId}`]) : null,
        gm.fetchedAt ? el('p', { class: 'quota-hint' }, [`更新于 ${formatQuotaClock(gm.fetchedAt)}`]) : null,
        gm.error ? el('p', { class: 'quota-error' }, [gm.error]) : null,
      ])
  const target = activeContextQuotaTarget()
  const isAuto = (state.pinnedQuota || 'auto') === 'auto'
  const targetContext = target.reason === 'chat'
    ? `当前会话 (${target.model?.model || target.channel})`
    : `新建默认 (${target.model?.model || target.channel})`

  const modeBanner = isAuto
    ? el('div', { class: 'quota-mode-banner is-auto' }, [
        el('div', { class: 'quota-mode-info' }, [
          el('span', { class: 'quota-mode-tag' }, ['智能跟随']),
          el('span', { class: 'quota-mode-desc' }, [`顶栏对标 ${targetContext}`]),
        ]),
      ])
    : el('div', { class: 'quota-mode-banner is-pinned' }, [
        el('div', { class: 'quota-mode-info' }, [
          el('span', { class: 'quota-mode-tag is-pinned' }, [`已锁定 ${state.pinnedQuota}`]),
          el('span', { class: 'quota-mode-desc' }, ['顶栏已固定显示该模型']),
        ]),
        el('button', {
          type: 'button',
          class: 'quota-mode-reset',
          onclick: () => {
            state.pinnedQuota = 'auto'
            try { localStorage.setItem('dsh-mp-pinned-quota-v2', 'auto') } catch {}
            patchQuotaBarInDom()
            syncSheetPortal(true)
          },
        }, ['恢复智能跟随']),
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
      modeBanner,
      el('div', { class: 'sheet-body' }, [dsBody, gkBody, gmBody]),
    ]),
  ])
}
