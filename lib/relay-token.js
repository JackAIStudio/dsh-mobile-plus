/**
 * Relay token encode and parse helpers.
 */
export function parseRelayToken(input) {
  if (typeof input !== 'string') throw new Error('口令必须是字符串')
  const text = input.trim()
  if (!text) throw new Error('口令不能为空')

  if (text.startsWith('jds://relay')) {
    const url = new URL(text.replace(/^jds:\/\//, 'http://dummy/'))
    const server = url.searchParams.get('s')
    const token = url.searchParams.get('t')
    const publicBaseUrl = url.searchParams.get('p') || ''
    if (!server || !token) throw new Error('口令缺少 server 或 token')
    return {
      enabled: true,
      server,
      token,
      publicBaseUrl: publicBaseUrl || (server.startsWith('ws') ? server.replace(/^wss?:\/\//, 'https://').replace(/\/relay\/tunnel.*$/, '') : ''),
    }
  }

  if (text.startsWith('{') && text.endsWith('}')) {
    const parsed = JSON.parse(text)
    if (!parsed.server || !parsed.token) throw new Error('JSON 缺少 server 或 token')
    return {
      enabled: true,
      server: parsed.server,
      token: parsed.token,
      publicBaseUrl: parsed.publicBaseUrl || '',
    }
  }

  throw new Error('未识别的中转口令格式')
}

export function encodeRelayToken(config) {
  const server = (config?.server || '').trim()
  const token = (config?.token || '').trim()
  const publicBaseUrl = (config?.publicBaseUrl || '').trim()
  if (!server || !token) throw new Error('缺少 server 或 token')
  const p = new URLSearchParams()
  p.set('s', server)
  p.set('t', token)
  if (publicBaseUrl) p.set('p', publicBaseUrl)
  return `jds://relay?${p.toString()}`
}
