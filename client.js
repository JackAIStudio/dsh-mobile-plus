/**
 * dsh-mobile-plus — browser half (client bundle).
 *
 * Host-page trigger is icon-only (smartphone + remote-signal outline).
 * The pairing panel is a 1:1 port of `@linxin666/dsh-remote-web-ui`'s
 * `src/client/RemotePanel.tsx` + `src/client/remote.module.css` (the
 * "远程访问" panel shipped by @linxin666/dsh-web-all): same layout, same
 * design tokens, same copy — adapted to OUR independent `/mp/pair/*`
 * routes (issue / status / stop / revoke). The host returns both the
 * public and the loopback QR (`qr` / `qrLocal`) for one token, so the
 * "选择二维码指向的网络" picker switches client-side without re-minting.
 *
 * The bundle is a classic script that registers one lazy factory with the
 * client module loader (see @deepseek-ai/dsh-client-modules); externals are
 * `react` and `react-dom`, which the shell seeds statically.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mobile-plus',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var createPortal = require('react-dom').createPortal

    /* CSS: trigger kept from v0.2; panel classes are remote.module.css
       (relevant slice) renamed with the mp- prefix. Tokens only. */
    const MP_CSS = [
      '/* dsh-mobile-plus — sidebar foot trigger + pairing panel (port of dsh-remote-web-ui remote.module.css) */',
      '.mp-trigger{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}',
      /* Host foot is a column (footer.action above Settings). Pull the icon
         onto the Settings row, right side, while the sidebar is expanded. */
      '[class*="_footArea"]:has(.mp-trigger-wide){flex-direction:row;align-items:center;gap:4px}',
      '[class*="_footArea"]:has(.mp-trigger-wide) [class*="_settingsArea"]{flex:1 1 auto;width:auto;min-width:0}',
      '[class*="_footArea"]:has(.mp-trigger-wide) [class*="_footerActions"]{order:2;flex:none;width:auto;align-items:center;justify-content:flex-end}',
      '.mp-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.mp-trigger:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.mp-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary)}',
      '.mp-trigger:disabled{opacity:.5;cursor:default}',
      '.mp-trigger svg{display:block;flex:none}',
      '.mp-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center}',
      '.mp-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}',
      '.mp-panel{position:relative;z-index:1;display:flex;flex-direction:column;gap:14px;width:560px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);overflow:auto;box-sizing:border-box;padding:24px;border-radius:24px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}',
      '.mp-header{display:flex;align-items:flex-start;gap:12px}',
      '.mp-heading{flex:1;min-width:0}',
      '.mp-title{margin:0;font-size:18px;font-weight:600;line-height:26px}',
      '.mp-subtitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.mp-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}',
      '.mp-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.mp-close:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.mp-close:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary)}',
      '.mp-close:disabled{opacity:.5;cursor:default}',
      '.mp-card{display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}',
      '.mp-card-header{display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px}',
      '.mp-card-title{font-weight:500}',
      '.mp-badges{display:inline-flex;align-items:center;gap:6px;flex:none}',
      '.mp-badge{display:inline-flex;flex:none;align-items:center;gap:6px;min-width:0;padding:2px 10px;border-radius:999px;font-size:12px;line-height:18px;white-space:nowrap}',
      '.mp-badge::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}',
      '.mp-badge-waiting{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.mp-badge-connected{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.mp-badge-disconnected{color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.mp-badge-stopped{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.mp-badge-public{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.mp-qr-wrap{display:flex;align-items:center;justify-content:center;padding:12px;border-radius:12px;background:var(--dsw-alias-bg-base)}',
      '.mp-qr{display:block;width:184px;height:184px}',
      '.mp-expired{margin:0;color:var(--dsw-alias-state-error-primary);font-size:13px}',
      '.mp-expiry{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.mp-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.mp-link{display:block;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px}',
      '.mp-pair-links{display:flex;flex-direction:column;gap:8px}',
      '.mp-pair-link-row{display:flex;align-items:center;gap:10px;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.mp-pair-link-text{min-width:0;flex:1}',
      '.mp-pair-link-label{display:block;margin-bottom:3px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.mp-copy-link{display:inline-flex;flex:none;align-items:center;gap:5px;min-height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;white-space:nowrap;transition:background-color 120ms ease,border-color 120ms ease,box-shadow 120ms ease}',
      '.mp-copy-link:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover)}',
      '.mp-copy-link:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.mp-copy-link:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary)}',
      '.mp-copy-link:disabled{opacity:.55;cursor:default}',
      '.mp-one-time-hint{margin:0;color:var(--dsw-alias-label-caption);font-size:12px}',
      '.mp-stopped-hint{margin:0;color:var(--dsw-alias-state-error-primary);font-size:13px}',
      '.mp-addresses{margin:12px 0 0;padding:0;border:none}',
      '.mp-addresses legend{padding:0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.mp-address{display:flex;align-items:center;gap:8px;margin-top:6px;padding:4px 6px;border-radius:6px;color:var(--dsw-alias-label-primary);font-size:13px;font-variant-numeric:tabular-nums;cursor:pointer;transition:background-color 120ms ease}',
      '.mp-address:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.mp-address input:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary);border-radius:50%}',
      '.mp-address-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.mp-address-hint{margin:6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.mp-actions{display:flex;gap:8px}',
      '.mp-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;white-space:nowrap;transition:background-color 120ms ease,border-color 120ms ease,box-shadow 120ms ease}',
      '.mp-action:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover)}',
      '.mp-action:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.mp-action:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary)}',
      '.mp-action:disabled{opacity:.5;cursor:default}',
      '.mp-devices{display:flex;flex-direction:column;gap:8px;padding:12px 16px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}',
      '.mp-devices-title{margin:0;font-size:13px;font-weight:500;line-height:20px}',
      '.mp-devices-empty{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.mp-device-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}',
      '.mp-device-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.mp-device-meta{min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.mp-device-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}',
      '.mp-device-presence{font-size:12px;line-height:18px}',
      '.mp-device-online{color:var(--dsw-alias-state-success-primary)}',
      '.mp-device-offline{color:var(--dsw-alias-label-secondary)}',
      '.mp-device-seen{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}',
      '.mp-device-revoke{flex:none;border:none;border-radius:8px;padding:6px 10px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;transition:background-color 120ms ease,color 120ms ease}',
      '.mp-device-revoke:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.mp-device-revoke:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2),0 0 0 4px var(--dsw-alias-brand-primary)}',
      '.mp-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:13px}',
      '.mp-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '@media (prefers-reduced-motion: reduce){.mp-trigger,.mp-close,.mp-copy-link,.mp-action,.mp-address,.mp-device-revoke{transition:none}}',
    ].join('')
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-mobile-plus/ui.css"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-mobile-plus'
      tag.dataset.pluginCss = 'dsh-mobile-plus/ui.css'
      tag.textContent = MP_CSS
      document.head.appendChild(tag)
    }

    var h = React.createElement

    /* ── 16px outline icons (same glyphs as dsh-client-ui-primitives) ── */
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

    /**
     * Host-page trigger: a currentColor outline smartphone + remote signal.
     * Matches the sidebar's 16px stroke icons so the external GUI only sees
     * one quiet logo — no Chinese label, no gradient tile.
     */
    function RemoteLogo({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3.2, y: 1.55, width: 7.4, height: 12.9, rx: 1.7, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M5.55 3.2h2.7', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M5.75 12.85h2.3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M12.35 5.1c1.4 1.05 1.4 4.75 0 5.8', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' }),
        h('path', { d: 'M11.3 6.35c.78.7.78 2.6 0 3.3', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' }))
    }

    /* ── helpers ported from dsh-remote-web-ui src/client ── */

    /** Derive a short, non-sensitive device label from a browser User-Agent. */
    function deviceNameFromUserAgent(userAgent) {
      if (userAgent === undefined || userAgent === null || String(userAgent).trim() === '') return undefined
      const os = /Windows NT/i.test(userAgent) ? 'Windows'
        : /Android/i.test(userAgent) ? 'Android'
        : /iPhone|iPad|iPod/i.test(userAgent) ? 'iOS'
        : /Macintosh|Mac OS X/i.test(userAgent) ? 'macOS'
        : /Linux/i.test(userAgent) ? 'Linux'
        : undefined
      const browser = /Edg(?:A|iOS)?\//i.test(userAgent) ? 'Edge'
        : /(?:OPR|Opera)\//i.test(userAgent) ? 'Opera'
        : /(?:Chrome|CriOS)\//i.test(userAgent) ? 'Chrome'
        : /(?:Firefox|FxiOS)\//i.test(userAgent) ? 'Firefox'
        : /Safari\//i.test(userAgent) && /Version\//i.test(userAgent) ? 'Safari'
        : undefined
      if (os !== undefined && browser !== undefined) return `${os} · ${browser}`
      return os ?? browser
    }

    /** Human-readable expiry clock, e.g. "10:35". */
    function formatClock(epochMs) {
      const date = new Date(epochMs)
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      return `${hours}:${minutes}`
    }

    /** Calendar + clock for last-seen timestamps, e.g. "2026-08-19 10:35". */
    function formatLastSeen(epochMs) {
      const date = new Date(epochMs)
      const year = String(date.getFullYear())
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day} ${formatClock(epochMs)}`
    }

    async function copyText(text) {
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text)
          return true
        } catch { /* fall through */ }
      }
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        return ok
      } catch {
        return false
      }
    }

    async function issuePair() {
      const res = await fetch('/mp/pair/issue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.code || 'issue failed')
      return data
    }

    async function pairStatus() {
      try {
        const res = await fetch('/mp/pair/status', { credentials: 'same-origin' })
        const data = await res.json()
        return {
          deviceCount: typeof data.deviceCount === 'number' ? data.deviceCount : 0,
          onlineCount: typeof data.onlineCount === 'number' ? data.onlineCount : 0,
          devices: Array.isArray(data.devices) ? data.devices : [],
          paired: data.paired === true,
        }
      } catch {
        return { deviceCount: 0, onlineCount: 0, devices: [], paired: false }
      }
    }

    async function stopPair() {
      const res = await fetch('/mp/pair/stop', { method: 'POST' })
      if (!res.ok) throw new Error(`stop failed with ${res.status}`)
    }

    async function revokePair(deviceId) {
      const res = await fetch('/mp/pair/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      })
      if (res.status === 404) return
      if (!res.ok) throw new Error(`revoke failed with ${res.status}`)
    }

    /** Badge text + tone per phase (ready states only). */
    function statusOf(status, stopped) {
      if (stopped) return { text: '已停止远程访问', tone: 'stopped' }
      if (status.deviceCount > 0) {
        return status.onlineCount > 0
          ? { text: `已连接 ${status.onlineCount} 台设备`, tone: 'connected' }
          : { text: '已配对设备离线', tone: 'disconnected' }
      }
      return { text: '等待设备连接', tone: 'waiting' }
    }

    /**
     * The pairing panel — 1:1 port of RemotePanel (ready state), driven by
     * our /mp/pair/* issue/status data.
     */
    function MpPanel(props) {
      const {
        issue, publicQr, status, stopped, expired, copied, busy, error,
        onClose, onRefresh, onStop, onCopy, onPickPublic, onPickLocal, onRevoke,
      } = props
      const badge = statusOf(status, stopped)
      const localOrigin = (() => {
        try { return new URL(issue.localUrl).origin } catch { return issue.localUrl }
      })()
      return h('div', { className: 'mp-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '手机发图远程' },
        h('div', { className: 'mp-header' },
          h('div', { className: 'mp-heading' },
            h('h2', { className: 'mp-title' }, ['手机发图远程']),
            h('p', { className: 'mp-subtitle' }, ['独立插件 · 支持文字与文件 · 不影响原 /m/'])),
          h('button', { type: 'button', className: 'mp-close', 'aria-label': '关闭手机发图远程面板', onClick: onClose },
            h(IconClose16, { size: 14 }))),

        h('div', { className: 'mp-card' },
          h('div', { className: 'mp-card-header' },
            h('span', { className: 'mp-card-title' }, ['设备配对']),
            h('span', { className: 'mp-badges' },
              publicQr ? h('span', { className: 'mp-badge mp-badge-public' }, ['公网']) : null,
              h('span', { className: `mp-badge mp-badge-${badge.tone}` }, [badge.text]))),
          h('div', { className: 'mp-qr-wrap' },
            h('img', { className: 'mp-qr', src: publicQr ? issue.qr : issue.qrLocal, alt: '手机扫码配对二维码' })),
          expired
            ? h('p', { className: 'mp-expired' }, ['二维码已过期，请刷新'])
            : h('p', { className: 'mp-expiry' }, [`二维码有效至 ${formatClock(issue.expiresAt)}`])),

        h('p', { className: 'mp-hint' }, [publicQr ? '公网链接：设备无需与本机处于同一网络' : '无法扫码？可直接打开下方配对链接']),
        h('div', { className: 'mp-pair-links' },
          h('div', { className: 'mp-pair-link-row' },
            h('div', { className: 'mp-pair-link-text' },
              h('span', { className: 'mp-pair-link-label' }, ['手机配对链接']),
              h('code', { className: 'mp-link', title: issue.url }, [issue.url])),
            h('button', { type: 'button', className: 'mp-copy-link', disabled: copied === 'phone', onClick: () => onCopy('phone', issue.url) },
              h(IconCopy16, { size: 14 }),
              [copied === 'phone' ? '已复制' : '复制手机链接'])),
          h('div', { className: 'mp-pair-link-row' },
            h('div', { className: 'mp-pair-link-text' },
              h('span', { className: 'mp-pair-link-label' }, ['电脑配对链接']),
              h('code', { className: 'mp-link', title: issue.localUrl }, [issue.localUrl])),
            h('button', { type: 'button', className: 'mp-copy-link', disabled: copied === 'desktop', onClick: () => onCopy('desktop', issue.localUrl) },
              h(IconCopy16, { size: 14 }),
              [copied === 'desktop' ? '已复制' : '复制电脑链接']))),
        h('p', { className: 'mp-one-time-hint' }, ['两条链接共用同一枚一次性令牌；任意设备配对成功后，另一条链接立即失效。']),
        stopped ? h('p', { className: 'mp-stopped-hint' }, ['已停止远程访问。点击"刷新二维码"重新开启。']) : null,

        h('fieldset', { className: 'mp-addresses' },
          h('legend', null, ['选择二维码指向的网络']),
          h('label', { className: 'mp-address' },
            h('input', { type: 'radio', name: 'mp-network', 'aria-label': '公网地址', checked: publicQr, onChange: onPickPublic }),
            h('span', null, ['公网地址']),
            h('code', { className: 'mp-address-value' }, [issue.publicBaseUrl || localOrigin])),
          h('label', { className: 'mp-address' },
            h('input', { type: 'radio', name: 'mp-network', 'aria-label': localOrigin, checked: !publicQr, onChange: onPickLocal }),
            h('span', null, ['局域网']),
            h('code', { className: 'mp-address-value' }, [localOrigin])),
          h('p', { className: 'mp-address-hint' }, ['远程设备不在同一网络时请使用公网地址；局域网地址仅限同一网络内使用。'])),

        h('div', { className: 'mp-actions' },
          h('button', { type: 'button', className: 'mp-action', disabled: busy || stopped, onClick: onStop },
            h(IconStop16, { size: 14 }),
            ['停止']),
          h('button', { type: 'button', className: 'mp-action', disabled: busy, onClick: onRefresh },
            h(IconRefresh16, { size: 14 }),
            ['刷新二维码'])),

        h('section', { className: 'mp-devices', 'aria-label': '已授权设备' },
          h('h3', { className: 'mp-devices-title' }, ['已授权设备']),
          status.devices.length === 0
            ? h('p', { className: 'mp-devices-empty' }, ['还没有已配对的设备。扫码或打开链接后会出现在这里。'])
            : h('ul', { className: 'mp-device-list' },
                status.devices.map((device) =>
                  h('li', { key: device.id, className: 'mp-device-row' },
                    h('div', { className: 'mp-device-meta' },
                      h('span', { className: 'mp-device-name' }, [deviceNameFromUserAgent(device.userAgent) ?? '未知设备']),
                      h('span', { className: `mp-device-presence ${device.online ? 'mp-device-online' : 'mp-device-offline'}` },
                        [device.online ? '在线' : '离线']),
                      h('span', { className: 'mp-device-seen' }, [`最近活动 ${formatLastSeen(device.lastSeenAt)}`])),
                    h('button', {
                      type: 'button',
                      className: 'mp-device-revoke',
                      'aria-label': '取消配对此设备',
                      onClick: () => { onRevoke(device.id) },
                    }, ['取消配对']))))),

        error ? h('p', { className: 'mp-error' }, [error]) : null,
        h('p', { className: 'mp-note' }, ['手机端发送的文件会写入工作区的 .dsh-mobile-inbox/，会话里只带本机路径']))
    }

    /** Sidebar foot entry: icon-only remote logo + the pairing panel.
     *  `wide` comes from the sidebar slot; the matching CSS class lets the
     *  trigger sit on the Settings row instead of a wasted extra line. */
    function MpEntry({ wide }) {
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [issue, setIssue] = React.useState(null)
      const [publicQr, setPublicQr] = React.useState(true)
      const [stopped, setStopped] = React.useState(false)
      const [expired, setExpired] = React.useState(false)
      const [status, setStatus] = React.useState({ deviceCount: 0, onlineCount: 0, devices: [], paired: false })
      const [error, setError] = React.useState('')
      const [copied, setCopied] = React.useState('')

      const mint = React.useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const data = await issuePair()
          setIssue(data)
          setStopped(false)
          setExpired(Date.now() > data.expiresAt)
        } catch (err) {
          setError(String(err?.message || err))
          setIssue(null)
        } finally {
          setBusy(false)
        }
      }, [])

      const openPanel = React.useCallback(() => {
        setOpen(true)
        void mint()
      }, [mint])

      const closePanel = React.useCallback(() => setOpen(false), [])

      const handleCopy = React.useCallback((key, url) => {
        void copyText(url).then((ok) => {
          if (!ok) return
          setCopied(key)
          window.setTimeout(() => setCopied(''), 1500)
        })
      }, [])

      const handleStop = React.useCallback(() => {
        void stopPair().catch(() => {})
        setStopped(true)
        setStatus((previous) => ({ ...previous, deviceCount: 0, onlineCount: 0, devices: [] }))
      }, [])

      const handleRevoke = React.useCallback((deviceId) => {
        void revokePair(deviceId).catch(() => {})
        setStatus((previous) => ({
          ...previous,
          devices: previous.devices.filter((device) => device.id !== deviceId),
          deviceCount: Math.max(0, previous.deviceCount - 1),
        }))
      }, [])

      // Live status mirror (the old plugin uses an SSE stream; our host has
      // no pair-events endpoint, so poll like v0.2 did).
      React.useEffect(() => {
        if (!open) return undefined
        const timer = window.setInterval(() => {
          void pairStatus().then(setStatus)
        }, 3000)
        void pairStatus().then(setStatus)
        return () => { window.clearInterval(timer) }
      }, [open])

      // Expiry flip: one timeout per token lifetime (reset by refresh).
      React.useEffect(() => {
        if (issue === null) return undefined
        if (expired) return undefined
        const delay = issue.expiresAt - Date.now()
        if (delay <= 0) {
          setExpired(true)
          return undefined
        }
        const timer = window.setTimeout(() => setExpired(true), delay)
        return () => { window.clearTimeout(timer) }
      }, [issue, expired])

      const overlay = open
        ? h('div', { className: 'mp-overlay', role: 'presentation' },
            h('div', { className: 'mp-mask', 'aria-hidden': 'true', onClick: closePanel }),
            issue
              ? h(MpPanel, {
                  issue, publicQr, status, stopped, expired, copied, busy, error,
                  onClose: closePanel,
                  onRefresh: mint,
                  onStop: handleStop,
                  onCopy: handleCopy,
                  onPickPublic: () => setPublicQr(true),
                  onPickLocal: () => setPublicQr(false),
                  onRevoke: handleRevoke,
                })
              : h('div', { className: 'mp-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '手机发图远程' },
                  h('div', { className: 'mp-header' },
                    h('div', { className: 'mp-heading' },
                      h('h2', { className: 'mp-title' }, ['手机发图远程']),
                      h('p', { className: 'mp-subtitle' }, ['独立插件 · 支持文字与文件 · 不影响原 /m/'])),
                    h('button', { type: 'button', className: 'mp-close', 'aria-label': '关闭手机发图远程面板', onClick: closePanel },
                      h(IconClose16, { size: 14 }))),
                  error ? h('p', { className: 'mp-error' }, [error]) : null,
                  h('div', { className: 'mp-actions' },
                    h('button', { type: 'button', className: 'mp-action', disabled: busy, onClick: mint },
                      h(IconRefresh16, { size: 14 }),
                      [busy ? '生成中…' : '生成配对链接']))))
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
        overlay && typeof document !== 'undefined' && document.body && typeof createPortal === 'function'
          ? createPortal(overlay, document.body)
          : overlay)
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () => {
        let dispose
        try {
          dispose = ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-mobile-plus' }, MpEntry)
        } catch {
          dispose = undefined
        }
        return () => { if (dispose) dispose() }
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
