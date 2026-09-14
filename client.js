/**
 * dsh-mobile-plus — browser half (client bundle).
 */
window.__ModuleLoader__.load({
  id: 'dsh-mobile-plus',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var createPortal = require('react-dom').createPortal

    const MP_CSS = "/* dsh-mobile-plus — sidebar foot trigger + pairing panel */ .mp-trigger{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease} [class*=\"_footArea\"]:has(.mp-trigger-wide){flex-direction:row;align-items:center;gap:4px} [class*=\"_footArea\"]:has(.mp-trigger-wide) [class*=\"_settingsArea\"]{flex:1 1 auto;width:auto;min-width:0} [class*=\"_footArea\"]:has(.mp-trigger-wide) [class*=\"_footerActions\"]{order:2;flex:none;width:auto;align-items:center;justify-content:flex-end} .mp-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)} .mp-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)} .mp-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary)} .mp-trigger:disabled{opacity:.5;cursor:default} .mp-trigger svg{display:block;flex:none} .mp-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center} .mp-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)} .mp-panel{position:relative;z-index:1;display:flex;flex-direction:column;gap:14px;width:600px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);overflow:auto;box-sizing:border-box;padding:24px;border-radius:24px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px} .mp-header{display:flex;align-items:flex-start;gap:12px} .mp-heading{flex:1;min-width:0} .mp-title{margin:0;font-size:18px;font-weight:600;line-height:26px} .mp-subtitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px} .mp-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color 120ms ease,color 120ms ease} .mp-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)} .mp-card{display:flex;flex-direction:column;align-items:center;gap:14px;padding:20px 16px 16px;border-radius:18px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)} .mp-card-header{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px} .mp-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)} .mp-badges{display:inline-flex;align-items:center;gap:6px} .mp-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:9999px;font-size:11px;line-height:16px;font-weight:500} .mp-badge-public{background:rgba(16,185,129,.12);color:rgb(16,185,129)} .mp-badge-connected{background:var(--dsw-alias-brand-subtle);color:var(--dsw-alias-brand-primary)} .mp-badge-waiting{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)} .mp-badge-disconnected,.mp-badge-stopped{background:var(--dsw-alias-danger-subtle);color:var(--dsw-alias-danger-primary)} .mp-qr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;width:100%;box-sizing:border-box} .mp-qr-card{display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)} .mp-qr-card-header{width:100%;display:flex;flex-direction:column;align-items:stretch;gap:4px;font-size:12px} .mp-qr-card-title{font-weight:600;font-size:13px} .mp-qr-card-desc{color:var(--dsw-alias-label-secondary);font-size:11px} .mp-card-origin{align-self:flex-start;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:10px;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)} .mp-qr{width:160px;height:160px;padding:8px;border-radius:12px;background:#fff;box-sizing:border-box;box-shadow:var(--dsw-shadow-lv1)} .mp-pair-code-banner{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)} .mp-pair-code-info{display:flex;flex-direction:column;gap:2px} .mp-pair-code-title{font-size:12px;font-weight:600} .mp-pair-code-desc{font-size:11px;color:var(--dsw-alias-label-secondary)} .mp-pair-code-display{display:flex;align-items:center;gap:8px} .mp-pair-code-val{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:18px;font-weight:700;letter-spacing:1px;color:var(--dsw-alias-label-primary)} .mp-expiry,.mp-expired{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary);text-align:center} .mp-expired{color:var(--dsw-alias-danger-primary);font-weight:500} .mp-pair-links{display:flex;flex-direction:column;gap:8px} .mp-pair-link-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)} .mp-pair-link-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px} .mp-pair-link-label{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary)} .mp-link{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)} .mp-actions{display:flex;align-items:center;gap:8px} .mp-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;cursor:pointer;transition:all 120ms ease} .mp-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)} .mp-copy-link{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;transition:all 120ms ease} .mp-copy-link:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)} .mp-devices{display:flex;flex-direction:column;gap:8px} .mp-devices-title{margin:0;font-size:12px;font-weight:600} .mp-devices-empty{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)} .mp-device-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px} .mp-device-row{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);font-size:12px} .mp-device-meta{display:flex;align-items:center;gap:8px} .mp-device-name{font-weight:500} .mp-device-presence{font-size:11px;padding:1px 6px;border-radius:9999px} .mp-device-online{background:rgba(16,185,129,.12);color:rgb(16,185,129)} .mp-device-offline{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)} .mp-device-seen{font-size:11px;color:var(--dsw-alias-label-secondary)} .mp-device-revoke{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer} .mp-device-revoke:hover{color:var(--dsw-alias-danger-primary)} .mp-relay-box{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px} .mp-relay-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:6px} .mp-relay-tab{padding:3px 8px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer} .mp-relay-tab.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)} .mp-relay-input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;font-family:var(--dsw-font-mono,ui-monospace,monospace)} .mp-relay-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px} .mp-relay-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap} .mp-error{color:var(--dsw-alias-danger-primary);font-size:12px;margin:0} .mp-note{color:var(--dsw-alias-label-secondary);font-size:11px;margin:0} .mp-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:middle} .mp-dot-online{background:#10b981} .mp-dot-connecting{background:#f59e0b} .mp-dot-offline{background:#ef4444} .mp-test-tag{margin-left:6px;font-size:11px;cursor:pointer;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)} .mp-test-res{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;font-family:var(--dsw-font-mono,ui-monospace,monospace)}"

    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="dsh-mobile-plus/ui.css"]')) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-mobile-plus'
      tag.dataset.pluginCss = 'dsh-mobile-plus/ui.css'
      tag.textContent = MP_CSS
      document.head.appendChild(tag)
    }

    var h = React.createElement

    function IconClose16({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
    }
    function IconCopy16({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.8, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3a1.8 1.8 0 0 0-1.8 1.8v4.4a1.8 1.8 0 0 0 1.8 1.8h.2', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }
    function IconRefresh16({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 1.9v2.6h-2.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    function IconStop16({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.6, fill: 'currentColor' }))
    }
    function IconGlobe16({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 8, cy: 8, r: 6.2, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M1.8 8h12.4M8 1.8c2 2.2 3.1 4.2 3.1 6.2s-1.1 4-3.1 6.2c-2-2.2-3.1-4.2-3.1-6.2s1.1-4 3.1-6.2z', stroke: 'currentColor', strokeWidth: 1.3 }))
    }
    function RemoteLogo({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3.2, y: 1.55, width: 7.4, height: 12.9, rx: 1.7, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M5.55 3.2h2.7M5.75 12.85h2.3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M12.35 5.1c1.4 1.05 1.4 4.75 0 5.8M11.3 6.35c.78.7.78 2.6 0 3.3', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' }))
    }

    function deviceNameFromUserAgent(ua) {
      if (!ua || !String(ua).trim()) return undefined
      const os = /Windows NT/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Macintosh|Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : undefined
      const br = /Edg(?:A|iOS)?\//i.test(ua) ? 'Edge' : /(?:Chrome|CriOS)\//i.test(ua) ? 'Chrome' : /Firefox|FxiOS\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) && /Version\//i.test(ua) ? 'Safari' : undefined
      return (os && br) ? `${os} · ${br}` : (os || br)
    }

    function formatClock(epochMs) {
      const d = new Date(epochMs)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    function formatLastSeen(epochMs) {
      const d = new Date(epochMs)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${formatClock(epochMs)}`
    }

    async function copyText(text) {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); return true } catch {}
      }
      try {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok
      } catch { return false }
    }

    async function issuePair() {
      const res = await fetch('/mp/pair/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.code || 'issue failed')
      return data
    }

    async function pairStatus() {
      try {
        const res = await fetch('/mp/pair/status', { credentials: 'same-origin' })
        const d = await res.json()
        return {
          deviceCount: typeof d.deviceCount === 'number' ? d.deviceCount : 0,
          onlineCount: typeof d.onlineCount === 'number' ? d.onlineCount : 0,
          devices: Array.isArray(d.devices) ? d.devices : [],
          paired: d.paired === true,
          relay: d.relay || null,
        }
      } catch {
        return { deviceCount: 0, onlineCount: 0, devices: [], paired: false, relay: null }
      }
    }

    async function stopPair() {
      const res = await fetch('/mp/pair/stop', { method: 'POST' })
      if (!res.ok) throw new Error(`stop failed with ${res.status}`)
    }

    async function revokePair(deviceId) {
      const res = await fetch('/mp/pair/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId }) })
      if (res.status !== 404 && !res.ok) throw new Error(`revoke failed with ${res.status}`)
    }

    function statusOf(status, stopped) {
      if (stopped) return { text: '已停止远程访问', tone: 'stopped' }
      if (status.deviceCount > 0) {
        return status.onlineCount > 0 ? { text: `已连接 ${status.onlineCount} 台设备`, tone: 'connected' } : { text: '已配对设备离线', tone: 'disconnected' }
      }
      return { text: '等待设备连接', tone: 'waiting' }
    }

    function MpRelaySettings({ onRefresh }) {
      const [tab, setTab] = React.useState('token')
      const [token, setToken] = React.useState('')
      const [host, setHost] = React.useState(''); const [port, setPort] = React.useState('22')
      const [pass, setPass] = React.useState(''); const [domain, setDomain] = React.useState('')
      const [loading, setLoading] = React.useState(false); const [msg, setMsg] = React.useState('')

      const handleImport = async () => {
        setLoading(true); setMsg('')
        try {
          const res = await fetch('/mp/relay/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tokenStr: token }) })
          const d = await res.json()
          if (!d.ok) throw new Error(d.error || '导入失败')
          setMsg('✔ 中转配置已生效！'); onRefresh()
        } catch (e) { setMsg('❌ ' + e.message) } finally { setLoading(false) }
      }

      const handlePaste = async () => {
        try { const t = await navigator.clipboard.readText(); if (t) setToken(t.trim()) } catch {}
      }

      const handleCopyCurrent = async () => {
        try {
          const res = await fetch('/mp/relay/config'); const d = await res.json()
          if (d.tokenStr) { await copyText(d.tokenStr); setMsg('✔ 已复制当前中转口令！') }
          else setMsg('⚠️ 当前尚未配置公网中转')
        } catch (e) { setMsg('❌ ' + e.message) }
      }

      const handleProvision = async () => {
        if (!host || !pass) { setMsg('❌ 服务器 IP 和密码不能为空'); return }
        setLoading(true); setMsg('正在连接服务器并自动化部署 (通常需 20~30 秒)...')
        try {
          const res = await fetch('/mp/relay/provision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host, port: parseInt(port, 10) || 22, password: pass, domain: domain.trim() }) })
          const d = await res.json()
          if (!d.ok) throw new Error(d.error || '云端部署失败')
          setMsg('🎉 云端部署成功！中转服务已启动'); onRefresh()
        } catch (e) { setMsg('❌ ' + e.message) } finally { setLoading(false) }
      }

      return h('div', { className: 'mp-relay-box' },
        h('div', { className: 'mp-relay-tabs' },
          h('button', { type: 'button', className: `mp-relay-tab ${tab === 'token' ? 'active' : ''}`, onClick: () => { setTab('token'); setMsg('') } }, ['📋 导入中转口令']),
          h('button', { type: 'button', className: `mp-relay-tab ${tab === 'ssh' ? 'active' : ''}`, onClick: () => { setTab('ssh'); setMsg('') } }, ['🚀 全新ECS一键部署'])),
        tab === 'token'
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              h('input', { className: 'mp-relay-input', placeholder: '粘贴中转口令 (jds://relay?...)', value: token, onChange: (e) => setToken(e.target.value) }),
              h('div', { className: 'mp-relay-actions' },
                h('button', { type: 'button', className: 'mp-action', disabled: loading, onClick: handleImport }, [loading ? '导入中…' : '导入中转口令']),
                h('button', { type: 'button', className: 'mp-copy-link', onClick: handlePaste }, ['粘贴']),
                h('button', { type: 'button', className: 'mp-copy-link', onClick: handleCopyCurrent }, ['复制当前中转口令'])))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              h('div', { className: 'mp-relay-grid' },
                h('input', { className: 'mp-relay-input', placeholder: '服务器 IP (如 47.xx.xx.xx)', value: host, onChange: (e) => setHost(e.target.value) }),
                h('input', { className: 'mp-relay-input', placeholder: 'SSH 端口 (默认 22)', value: port, onChange: (e) => setPort(e.target.value) })),
              h('div', { className: 'mp-relay-grid' },
                h('input', { className: 'mp-relay-input', type: 'password', placeholder: 'SSH root 密码', value: pass, onChange: (e) => setPass(e.target.value) }),
                h('input', { className: 'mp-relay-input', placeholder: '自定义域名 (选填)', value: domain, onChange: (e) => setDomain(e.target.value) })),
              h('div', { className: 'mp-relay-actions' },
                h('button', { type: 'button', className: 'mp-action', disabled: loading, onClick: handleProvision }, [loading ? '部署中 (约30秒)…' : '开始自动化部署']))),
        msg ? h('div', { style: { fontSize: '12px', color: msg.startsWith('✔') || msg.startsWith('🎉') ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-danger-primary)' } }, [msg]) : null)
    }

    function MpPanel(props) {
      const { issue, status, stopped, expired, copied, busy, error, onClose, onRefresh, onStop, onCopy, onRevoke } = props
      const [relayOpen, setRelayOpen] = React.useState(false)
      const [testInfo, setTestInfo] = React.useState('')
      const [testing, setTesting] = React.useState(false)

      const badge = statusOf(status, stopped)
      const relay = status?.relay || issue?.relay || null
      const isRelayConnected = relay?.status === 'connected'
      const isRelayConnecting = relay?.status === 'connecting'
      const hasPublic = typeof issue.publicBaseUrl === 'string' && issue.publicBaseUrl !== ''
      const hasLan = typeof issue.lanUrl === 'string' && issue.lanUrl !== ''
      const publicOrigin = (() => { try { return new URL(issue.url).origin } catch { return issue.publicBaseUrl || '' } })()
      const lanOrigin = (() => { try { return new URL(issue.lanUrl || issue.localUrl).origin } catch { return issue.lanIp || '' } })()

      const runTest = async () => {
        setTesting(true); setTestInfo('正在探测...')
        try {
          const res = await fetch('/mp/relay/test', { method: 'POST' })
          const d = await res.json()
          if (d.ok) setTestInfo(`✔ 通信正常 (延迟 ${d.latencyMs}ms) · 隧道在线`)
          else if (d.serverReachable) setTestInfo(`⚠️ 云端在线(${d.latencyMs}ms) · 但本机隧道未连通`)
          else setTestInfo(`❌ 云端未连通: ${d.error || '超时'}`)
        } catch (e) { setTestInfo(`❌ 检测失败: ${e.message}`) } finally { setTesting(false) }
      }

      let channelBadge = null
      if (hasPublic && hasLan) {
        channelBadge = isRelayConnected
          ? h('span', { className: 'mp-badge mp-badge-public' }, ['双通道已就绪'])
          : (isRelayConnecting
              ? h('span', { className: 'mp-badge mp-badge-waiting' }, ['局域网就绪 · 公网连接中'])
              : h('span', { className: 'mp-badge mp-badge-waiting' }, ['局域网通道已就绪']))
      } else if (hasPublic) {
        channelBadge = isRelayConnected
          ? h('span', { className: 'mp-badge mp-badge-public' }, ['公网就绪'])
          : (isRelayConnecting ? h('span', { className: 'mp-badge mp-badge-waiting' }, ['公网连接中...']) : h('span', { className: 'mp-badge mp-badge-disconnected' }, ['公网未连通']))
      } else if (hasLan) {
        channelBadge = h('span', { className: 'mp-badge mp-badge-public' }, ['局域网就绪'])
      }

      return h('div', { className: 'mp-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '手机远程' },
        h('div', { className: 'mp-header' },
          h('div', { className: 'mp-heading' },
            h('h2', { className: 'mp-title' }, ['手机远程']),
            h('p', { className: 'mp-subtitle' }, ['独立插件 · 支持文字与文件传输'])),
          h('button', { type: 'button', className: 'mp-close', 'aria-label': '关闭手机远程面板', onClick: onClose }, h(IconClose16, { size: 14 }))),

        h('div', { className: 'mp-card' },
          h('div', { className: 'mp-card-header' },
            h('span', { className: 'mp-card-title' }, ['扫码配对手机']),
            h('span', { className: 'mp-badges' },
              channelBadge,
              h('span', { className: `mp-badge mp-badge-${badge.tone}` }, [badge.text]))),

          h('div', { className: 'mp-qr-grid' },
            hasPublic ? h('div', { className: 'mp-qr-card' },
              h('div', { className: 'mp-qr-card-header' },
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                  h('span', { className: 'mp-qr-card-title' }, ['🌐 公网远程']),
                  h('span', { style: { fontSize: '11px', display: 'flex', alignItems: 'center' } },
                    h('span', { className: `mp-dot ${isRelayConnected ? 'mp-dot-online' : (isRelayConnecting ? 'mp-dot-connecting' : 'mp-dot-offline')}` }),
                    isRelayConnected ? '中转已连通' : (isRelayConnecting ? '正在连接...' : '中转未连接'),
                    h('button', { type: 'button', className: 'mp-test-tag', disabled: testing, onClick: runTest }, [testing ? '…' : '检测']))),
                testInfo ? h('div', { className: 'mp-test-res' }, [testInfo]) : null,
                h('span', { className: 'mp-qr-card-desc' }, ['适合外出 / 4G / 酒店']),
                h('code', { className: 'mp-card-origin', title: publicOrigin }, [publicOrigin])),
              h('img', { className: 'mp-qr', src: issue.qr, alt: '公网远程配对二维码' }),
              h('button', { type: 'button', className: 'mp-copy-link', disabled: copied === 'public', onClick: () => onCopy('public', issue.url) },
                [h(IconCopy16, { size: 14 }), copied === 'public' ? '已复制' : '复制公网链接'])) : null,

            hasLan ? h('div', { className: 'mp-qr-card' },
              h('div', { className: 'mp-qr-card-header' },
                h('span', { className: 'mp-qr-card-title' }, ['🟢 局域网极速']),
                h('span', { className: 'mp-qr-card-desc' }, ['适合同 Wi-Fi / 热点']),
                h('code', { className: 'mp-card-origin', title: lanOrigin }, [lanOrigin])),
              h('img', { className: 'mp-qr', src: issue.qrLan || issue.qrLocal, alt: '局域网极速配对二维码' }),
              h('button', { type: 'button', className: 'mp-copy-link', disabled: copied === 'lan', onClick: () => onCopy('lan', issue.lanUrl || issue.localUrl) },
                [h(IconCopy16, { size: 14 }), copied === 'lan' ? '已复制' : '复制局域网链接'])) : null),

          issue.code && !expired && !stopped ? h('div', { className: 'mp-pair-code-banner' },
            h('div', { className: 'mp-pair-code-info' },
              h('span', { className: 'mp-pair-code-title' }, ['手机已打开页面？输入 6 位配对码']),
              h('span', { className: 'mp-pair-code-desc' }, ['在手机设备配对页直接输入此数字，无需复制长链接'])),
            h('div', { className: 'mp-pair-code-display' },
              h('code', { className: 'mp-pair-code-val' }, [
                issue.code.length === 6 ? `${issue.code.slice(0, 3)} ${issue.code.slice(3)}` : issue.code,
              ]),
              h('button', { type: 'button', className: 'mp-copy-link', style: { padding: '0 10px', minHeight: '28px', fontSize: '12px' }, disabled: copied === 'code', onClick: () => onCopy('code', issue.code) },
                [h(IconCopy16, { size: 12 }), copied === 'code' ? '已复制' : '复制']))) : null,

          expired ? h('p', { className: 'mp-expired' }, ['二维码已过期，请刷新']) : h('p', { className: 'mp-expiry' }, [`二维码有效至 ${formatClock(issue.expiresAt)} · 一次性令牌`])),

        h('div', { className: 'mp-pair-links' },
          h('div', { className: 'mp-pair-link-row' },
            h('div', { className: 'mp-pair-link-text' },
              h('span', { className: 'mp-pair-link-label' }, ['电脑本机调试链接']),
              h('code', { className: 'mp-link', title: issue.localUrl }, [issue.localUrl])),
            h('button', { type: 'button', className: 'mp-copy-link', disabled: copied === 'desktop', onClick: () => onCopy('desktop', issue.localUrl) },
              h(IconCopy16, { size: 14 }), [copied === 'desktop' ? '已复制' : '复制电脑链接']))),

        stopped ? h('p', { className: 'mp-stopped-hint' }, ['已停止远程访问。点击"刷新二维码"重新开启。']) : null,

        h('div', { className: 'mp-actions' },
          h('button', { type: 'button', className: 'mp-action', disabled: busy || stopped, onClick: onStop }, h(IconStop16, { size: 14 }), ['停止']),
          h('button', { type: 'button', className: 'mp-action', disabled: busy, onClick: onRefresh }, h(IconRefresh16, { size: 14 }), ['刷新二维码']),
          h('button', { type: 'button', className: 'mp-action', onClick: () => setRelayOpen(!relayOpen) }, h(IconGlobe16, { size: 14 }), ['公网中转配置'])),

        relayOpen ? h(MpRelaySettings, { onRefresh }) : null,

        h('section', { className: 'mp-devices', 'aria-label': '已授权设备' },
          h('h3', { className: 'mp-devices-title' }, ['已授权设备']),
          status.devices.length === 0
            ? h('p', { className: 'mp-devices-empty' }, ['还没有已配对的设备。扫码或打开链接后会出现在这里。'])
            : h('ul', { className: 'mp-device-list' },
                status.devices.map((device) =>
                  h('li', { key: device.id, className: 'mp-device-row' },
                    h('div', { className: 'mp-device-meta' },
                      h('span', { className: 'mp-device-name' }, [deviceNameFromUserAgent(device.userAgent) ?? '未知设备']),
                      h('span', { className: `mp-device-presence ${device.online ? 'mp-device-online' : 'mp-device-offline'}` }, [device.online ? '在线' : '离线']),
                      h('span', { className: 'mp-device-seen' }, [`最近活动 ${formatLastSeen(device.lastSeenAt)}`])),
                    h('button', { type: 'button', className: 'mp-device-revoke', 'aria-label': '取消配对此设备', onClick: () => onRevoke(device.id) }, ['取消配对']))))),

        error ? h('p', { className: 'mp-error' }, [error]) : null,
        h('p', { className: 'mp-note' }, ['手机端发送的文件会写入工作区的 .dsh-mobile-inbox/，会话里只带本机路径']))
    }

    function MpEntry({ wide }) {
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [issue, setIssue] = React.useState(null)
      const [stopped, setStopped] = React.useState(false)
      const [expired, setExpired] = React.useState(false)
      const [status, setStatus] = React.useState({ deviceCount: 0, onlineCount: 0, devices: [], paired: false, relay: null })
      const [error, setError] = React.useState('')
      const [copied, setCopied] = React.useState('')

      const mint = React.useCallback(async () => {
        setBusy(true); setError('')
        try {
          const data = await issuePair()
          setIssue(data); setStopped(false); setExpired(Date.now() > data.expiresAt)
        } catch (err) {
          setError(String(err?.message || err)); setIssue(null)
        } finally { setBusy(false) }
      }, [])

      const openPanel = React.useCallback(() => { setOpen(true); void mint() }, [mint])
      const closePanel = React.useCallback(() => setOpen(false), [])

      const handleCopy = React.useCallback((key, url) => {
        void copyText(url).then((ok) => {
          if (!ok) return
          setCopied(key)
          window.setTimeout(() => setCopied((cur) => (cur === key ? '' : cur)), 1600)
        })
      }, [])

      const handleStop = React.useCallback(async () => {
        try { await stopPair(); setStopped(true) } catch (err) { setError(String(err?.message || err)) }
      }, [])

      const handleRevoke = React.useCallback((deviceId) => {
        void revokePair(deviceId).catch(() => {})
        setStatus((prev) => ({
          ...prev,
          devices: prev.devices.filter((d) => d.id !== deviceId),
          deviceCount: Math.max(0, prev.deviceCount - 1),
        }))
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const timer = window.setInterval(() => { void pairStatus().then(setStatus) }, 3000)
        void pairStatus().then(setStatus)
        return () => window.clearInterval(timer)
      }, [open])

      React.useEffect(() => {
        if (!issue || expired) return undefined
        const delay = issue.expiresAt - Date.now()
        if (delay <= 0) { setExpired(true); return undefined }
        const timer = window.setTimeout(() => setExpired(true), delay)
        return () => window.clearTimeout(timer)
      }, [issue, expired])

      const overlay = open
        ? h('div', { className: 'mp-overlay', role: 'presentation' },
            h('div', { className: 'mp-mask', 'aria-hidden': 'true', onClick: closePanel }),
            issue
              ? h(MpPanel, {
                  issue, status, stopped, expired, copied, busy, error,
                  onClose: closePanel, onRefresh: mint, onStop: handleStop,
                  onCopy: handleCopy, onRevoke: handleRevoke,
                })
              : h('div', { className: 'mp-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '手机远程' },
                  h('div', { className: 'mp-header' },
                    h('div', { className: 'mp-heading' },
                      h('h2', { className: 'mp-title' }, ['手机远程']),
                      h('p', { className: 'mp-subtitle' }, ['独立插件 · 支持文字与文件'])),
                    h('button', { type: 'button', className: 'mp-close', 'aria-label': '关闭手机远程面板', onClick: closePanel }, h(IconClose16, { size: 14 }))),
                  error ? h('p', { className: 'mp-error' }, [error]) : null,
                  h('div', { className: 'mp-actions' },
                    h('button', { type: 'button', className: 'mp-action', disabled: busy, onClick: mint }, h(IconRefresh16, { size: 14 }), [busy ? '生成中…' : '生成配对链接']))))
        : null

      return h('div', { className: 'mp-entry', style: { display: 'contents' } },
        h('button', {
          type: 'button',
          className: wide === false ? 'mp-trigger' : 'mp-trigger mp-trigger-wide',
          'aria-label': '手机远程',
          'aria-expanded': open,
          title: '手机远程',
          onClick: openPanel,
        }, h(RemoteLogo, { size: 18 })),
        overlay && typeof document !== 'undefined' && document.body && typeof createPortal === 'function' ? createPortal(overlay, document.body) : overlay)
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () => {
        let dispose
        try { dispose = ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-mobile-plus' }, MpEntry) } catch { dispose = undefined }
        return () => { if (dispose) dispose() }
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
