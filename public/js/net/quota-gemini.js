/**
 * Quota and balance tracking for Gemini (Google Antigravity / Cloud Code Assist).
 */
import { quota } from '../state/state.js'
import { formatQuotaClock, formatQuotaStamp } from '../utils/time.js'

export const GEMINI_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-.6 5-4 8.5-9 9 5 .5 8.4 4 9 9 .6-5 4-8.5 9-9-5-.5-8.4-4-9-9Z"/></svg>'

export function toPercent(fraction) {
  if (fraction === undefined || fraction === null || !Number.isFinite(fraction)) return null
  return Math.max(0, Math.min(100, Math.round(fraction * 1000) / 10))
}

export function parseGeminiQuota(raw) {
  const parsed = {
    gemini5h: null,
    geminiWeek: null,
    thirdParty5h: null,
    thirdPartyWeek: null,
    accountId: undefined,
    fetchedAt: undefined,
    error: undefined,
  }

  if (!raw || raw.present === false) return null

  if (raw.ok === false) {
    parsed.error = raw.error || 'Gemini 额度查询失败'
    return parsed
  }

  const value = raw.value || raw
  const quotaData = value.quota || value
  parsed.accountId = value.accountId
  parsed.fetchedAt = value.fetchedAt

  if (!quotaData || !Array.isArray(quotaData.groups)) {
    return parsed
  }

  for (const group of quotaData.groups) {
    const isGemini = group.displayName && /gemini/i.test(group.displayName)
    const is3P = group.displayName && /claude|gpt|3p|openai|anthropic/i.test(group.displayName)
    if (!isGemini && !is3P) continue
    if (!Array.isArray(group.buckets)) continue

    for (const bucket of group.buckets) {
      const is5h = bucket.window === '5h'
        || bucket.bucketId === 'gemini-5h'
        || bucket.bucketId === '3p-5h'
        || (bucket.displayName && /5\s*hour|five\s*hour/i.test(bucket.displayName))
      const isWeek = bucket.window === 'weekly'
        || bucket.bucketId === 'gemini-weekly'
        || bucket.bucketId === '3p-weekly'
        || (bucket.displayName && /week/i.test(bucket.displayName))

      const pct = toPercent(bucket.remainingFraction)
      if (pct === null) continue

      const info = {
        percent: pct,
        resetTime: bucket.resetTime,
        description: bucket.description,
      }

      if (isGemini && is5h) parsed.gemini5h = info
      if (isGemini && isWeek) parsed.geminiWeek = info
      if (is3P && is5h) parsed.thirdParty5h = info
      if (is3P && isWeek) parsed.thirdPartyWeek = info
    }
  }

  return parsed
}

export function geminiView() {
  const row = quota.gemini
  if (!row || row.present === false) return null

  const parsed = parseGeminiQuota(row)
  const loading = quota.status === 'loading'

  if (!parsed) return null

  if (parsed.error) {
    return {
      amount: '查不到',
      capsuleLabel: '查不到',
      kind: 'error',
      loading,
      error: parsed.error,
    }
  }

  const candidateVals = [
    parsed.gemini5h?.percent,
    parsed.geminiWeek?.percent,
  ].filter((v) => typeof v === 'number')

  let primaryVal = null
  if (candidateVals.length > 0) {
    primaryVal = Math.min(...candidateVals)
  } else {
    const fallbackVals = [parsed.thirdParty5h?.percent, parsed.thirdPartyWeek?.percent].filter((v) => typeof v === 'number')
    if (fallbackVals.length > 0) {
      primaryVal = Math.min(...fallbackVals)
    }
  }

  if (primaryVal === null) {
    if (quota.status === 'ready') return { amount: '无额度', capsuleLabel: '无额度', kind: 'muted', loading }
    return { amount: '查询中', capsuleLabel: '查询中', kind: 'muted', loading: true }
  }

  const kind = primaryVal <= 10 ? 'alert' : primaryVal <= 25 ? 'warn' : 'ready'

  let geminiLine = ''
  if (parsed.gemini5h && parsed.geminiWeek) {
    geminiLine = `Gemini: 5小时 ${parsed.gemini5h.percent}% · 周限额 ${parsed.geminiWeek.percent}%`
  } else if (parsed.gemini5h) {
    geminiLine = `Gemini: 5小时 ${parsed.gemini5h.percent}%`
  } else if (parsed.geminiWeek) {
    geminiLine = `Gemini: 周限额 ${parsed.geminiWeek.percent}%`
  }

  let thirdPartyLine = ''
  if (parsed.thirdParty5h && parsed.thirdPartyWeek) {
    thirdPartyLine = `Claude / GPT: 5小时 ${parsed.thirdParty5h.percent}% · 周限额 ${parsed.thirdPartyWeek.percent}%`
  } else if (parsed.thirdParty5h) {
    thirdPartyLine = `Claude / GPT: 5小时 ${parsed.thirdParty5h.percent}%`
  } else if (parsed.thirdPartyWeek) {
    thirdPartyLine = `Claude / GPT: 周限额 ${parsed.thirdPartyWeek.percent}%`
  }

  const resetParts = []
  if (parsed.gemini5h?.resetTime) {
    resetParts.push(`5小时重置 ${formatQuotaClock(parsed.gemini5h.resetTime)}`)
  }
  if (parsed.geminiWeek?.resetTime) {
    resetParts.push(`周重置 ${formatQuotaStamp(parsed.geminiWeek.resetTime)}`)
  }
  const resetLine = resetParts.join(' · ')

  return {
    amount: `${primaryVal}% 剩余`,
    capsuleLabel: `${primaryVal}%`,
    primaryVal,
    kind,
    loading,
    geminiLine,
    thirdPartyLine,
    resetLine,
    accountId: parsed.accountId,
    fetchedAt: parsed.fetchedAt,
    parsed,
  }
}
