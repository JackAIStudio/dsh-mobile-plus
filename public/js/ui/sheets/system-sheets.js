/**
 * System and PWA install bottom sheets.
 */
import { state, runtime } from '../../state/state.js'
import { el } from '../../utils/dom.js'
import { call } from '../../net/rpc.js'
import { isSecurePage, isAppleMobile } from '../../app.js'
import { reloadApp } from '../theme.js'
import { closeSheet } from './portal.js'

export function pwaSheet() {
  const secure = isSecurePage()
  const apple = isAppleMobile()
  const canPrompt = Boolean(runtime.deferredInstallPrompt)
  const steps = apple
    ? [
      '点 Safari 底部中间的分享按钮（方框、箭头朝上）',
      '往下滚，点「添加到主屏幕」',
      '右上角点「添加」',
    ]
    : [
      '点浏览器菜单（通常是右上角 ⋯）',
      '选「添加到主屏幕」或「安装应用」',
      '确认添加',
    ]
  const close = () => closeSheet()
  return el('div', { class: 'sheet-backdrop', onclick: close }, [
    el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '添加到主屏幕', onclick: (ev) => { ev.stopPropagation() } }, [
      el('div', { class: 'sheet-handle' }),
      el('div', { class: 'sheet-title' }, ['添加到主屏幕']),
      el('div', { class: 'sheet-body' }, [
        el('p', { class: 'sheet-confirm-desc' }, ['加到主屏幕以后，下次从图标打开就是独立 App，没有 Safari 底栏。']),
        el('div', { class: `pwa-secure${secure ? ' is-ok' : ' is-warn'}` }, [
          secure
            ? '当前已是 HTTPS，可以添加。'
            : '当前是 HTTP（Safari 会显示「不安全」）。只有 HTTPS 才能真正当 App 打开；现在加进去，下次仍会进浏览器。',
        ]),
        el('div', { class: 'sheet-section' }, [
          el('div', { class: 'sheet-section-title' }, [apple ? 'Safari' : '浏览器']),
          el('ol', { class: 'pwa-steps' }, steps.map((text, idx) => el('li', { class: 'pwa-step' }, [
            el('span', { class: 'pwa-step-n', 'aria-hidden': 'true' }, [String(idx + 1)]),
            el('span', { class: 'pwa-step-text' }, [text]),
          ]))),
        ]),
        el('div', { class: 'pwa-actions' }, [
          canPrompt
            ? el('button', {
                type: 'button',
                class: 'mobile-new',
                onclick: () => { void promptPwaInstall() },
              }, ['安装到主屏幕'])
            : null,
          el('button', { type: 'button', class: 'mobile-button', onclick: close }, ['知道了']),
        ]),
      ]),
    ]),
  ])
}

export async function promptPwaInstall() {
  if (!runtime.deferredInstallPrompt) return
  const promptEvent = runtime.deferredInstallPrompt
  runtime.deferredInstallPrompt = null
  try {
    await promptEvent.prompt()
  } catch {
    /* user dismissed or the browser cancelled */
  }
  closeSheet()
}

export function powerSheet() {
  const close = () => closeSheet()
  return el('div', { class: 'sheet-backdrop', onclick: close }, [
    el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '系统操作', onclick: (ev) => { ev.stopPropagation() } }, [
      el('div', { class: 'sheet-handle' }),
      el('div', { class: 'sheet-title' }, ['系统操作']),
      el('div', { class: 'sheet-body' }, [
        el('div', { class: 'pwa-actions', style: 'display: flex; flex-direction: column; gap: 12px;' }, [
          el('button', { type: 'button', class: 'mobile-button', onclick: () => { close(); reloadApp() } }, ['刷新前端页面']),
          el('button', { type: 'button', class: 'mobile-new', style: 'background: var(--dsw-alias-state-error-primary); border-color: transparent;', onclick: () => {
            if (!window.confirm('确定要重启 DSH 服务端吗？\n\n这会中断所有正在运行的任务，如果你的宿主不是通过 pm2 等工具常驻运行的，可能需要手动去终端重新启动。')) return
            close()
            void call('host.restart', {}).then((res) => {
              if (!res.ok) alert('重启请求失败: ' + (res.error?.message || '未知错误'))
              else setTimeout(() => reloadApp(), 1500)
            }).catch((err) => alert('发送重启指令失败: ' + err.message))
          } }, ['重启核心服务']),
        ]),
      ]),
    ]),
  ])
}
