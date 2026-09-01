/**
 * Time and currency formatting helpers.
 */

export function formatTime(ms) {
    if (!ms) return ''
    const date = new Date(ms)
    const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    const today = new Date()
    if (date.toDateString() === today.toDateString()) return clock
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`
    return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
  }

export function getTodayDateString() {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

export function formatMoney(currency, amount) {
    if (!Number.isFinite(amount)) return '—'
    const body = amount.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    if (currency === 'CNY') return '¥' + body
    if (currency === 'USD') return '$' + body
    return body + ' ' + currency
  }

export function formatBytes(n) {
    if (!Number.isFinite(n) || n < 0) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    const mb = n / (1024 * 1024)
    return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`
  }
