/**
 * Settings and control bottom sheet.
 */
import { state, chat, runtime } from '../../state/state.js'
import { el } from '../../utils/dom.js'
import { writeStoredBoolean } from '../../utils/storage.js'
import { call } from '../../net/rpc.js'
import { contextUsage } from '../../chat/composer.js'
import { quotaSummary, openQuotaSheet } from '../../net/quota.js'
import { reloadApp, isDarkTheme, toggleTheme } from '../theme.js'
import { unlockAudio, previewNotification } from '../../utils/notify.js'
import { closeSheet, switchSheet, syncSheetPortal } from './portal.js'
import { openModelSheet } from './model-sheet.js'

export function settingsToggleRow(title, desc, value, onToggle) {
  return el('div', { class: 'sheet-toggle-row' }, [
    el('div', { class: 'sheet-toggle-copy' }, [
      el('span', { class: 'sheet-toggle-title' }, [title]),
      el('span', { class: 'sheet-toggle-desc' }, [desc]),
    ]),
    el('button', {
      type: 'button',
      class: `sheet-toggle-switch${value ? ' sheet-toggle-switch-on' : ''}`,
      role: 'switch',
      'aria-checked': String(value),
      'aria-label': title,
      onclick: () => { onToggle(!value) },
    }, [el('span', { class: 'sheet-toggle-switch-knob' })]),
  ])
}

export function settingsSheet() {
  const inChat = state.view === 'chat'
  const pct = inChat ? contextUsage() : undefined
  const pctWarn = pct !== undefined && pct >= 80
  const model = chat.currentModel

  const sections = []

  if (inChat) {
    sections.push(el('div', { class: 'sheet-section' }, [
      el('div', { class: 'sheet-section-title' }, ['当前会话模型']),
      el('button', {
        type: 'button',
        class: 'sheet-nav-row',
        'aria-haspopup': 'dialog',
        'aria-label': '选择模型与思考强度',
        onclick: () => void openModelSheet(),
      }, [
        el('div', { class: 'sheet-toggle-copy' }, [
          el('span', { class: 'sheet-toggle-title' }, [model?.model || '选择模型']),
          el('span', { class: 'sheet-toggle-desc' }, [
            model?.reasoningEffort
              ? `思考强度 ${model.reasoningEffort}`
              : '更换模型或思考强度',
          ]),
        ]),
        el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['›']),
      ]),
      el('div', { class: 'sheet-toggle-row' }, [
        el('div', { class: 'sheet-toggle-copy' }, [
          el('span', { class: 'sheet-toggle-title' }, ['上下文占用']),
          el('span', { class: 'sheet-toggle-desc' }, [
            pct === undefined
              ? '等模型回复后才会显示'
              : (pctWarn ? '接近上限，建议新开会话' : '当前会话已用上下文窗口比例'),
          ]),
        ]),
        el('span', {
          class: pctWarn ? 'sheet-context-value sheet-context-value-warn' : 'sheet-context-value',
        }, [pct === undefined ? '—' : `${pct}%`]),
      ]),
    ]))

    sections.push(el('div', { class: 'sheet-section' }, [
      el('div', { class: 'sheet-section-title' }, ['会话显示偏好']),
      settingsToggleRow('工具调用折叠', '在消息流中显示工具调用卡片', chat.showToolCalls, (v) => {
        chat.showToolCalls = v
        writeStoredBoolean('dsh.mobile.showToolCalls', v)
        syncSheetPortal(true)
      }),
      settingsToggleRow('显示系统提示', '显示宿主注入的系统提示消息', chat.showSystemMessages, (v) => {
        chat.showSystemMessages = v
        writeStoredBoolean('dsh.mobile.showSystemMessages', v)
        syncSheetPortal(true)
      }),
    ]))
  }

  sections.push(el('div', { class: 'sheet-section' }, [
    el('div', { class: 'sheet-section-title' }, ['账户额度']),
    el('button', {
      type: 'button',
      class: 'sheet-nav-row',
      'aria-haspopup': 'dialog',
      'aria-label': '查看 DeepSeek 余额与 Grok 已使用额度',
      onclick: () => openQuotaSheet(),
    }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['余额与用量明细']),
        el('span', { class: 'sheet-toggle-desc' }, [quotaSummary()]),
      ]),
      el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['›']),
    ]),
  ]))

  sections.push(el('div', { class: 'sheet-section' }, [
    el('div', { class: 'sheet-section-title' }, ['列表排序']),
    el('button', {
      type: 'button',
      class: `sheet-option${state.sortMode === 'recent' ? ' sheet-option-selected' : ''}`,
      onclick: () => {
        state.sortMode = 'recent'
        try { localStorage.setItem('dsh-mp-sort-mode', 'recent') } catch {}
        syncSheetPortal(true)
      },
    }, [
      el('div', { class: 'sheet-option-copy' }, [
        el('span', { class: 'sheet-option-title' }, ['最近更新（默认）']),
        el('span', { class: 'sheet-option-desc' }, ['按会话最后更新或活跃时间倒序排列']),
      ]),
      state.sortMode === 'recent' ? el('span', { class: 'sheet-option-check', 'aria-hidden': 'true' }, ['✓']) : null,
    ]),
    el('button', {
      type: 'button',
      class: `sheet-option${state.sortMode === 'manual' ? ' sheet-option-selected' : ''}`,
      onclick: () => {
        state.sortMode = 'manual'
        try { localStorage.setItem('dsh-mp-sort-mode', 'manual') } catch {}
        syncSheetPortal(true)
      },
    }, [
      el('div', { class: 'sheet-option-copy' }, [
        el('span', { class: 'sheet-option-title' }, ['手动排序']),
        el('span', { class: 'sheet-option-desc' }, ['保持 Web 桌面端自定义拖拽或创建的原生顺序']),
      ]),
      state.sortMode === 'manual' ? el('span', { class: 'sheet-option-check', 'aria-hidden': 'true' }, ['✓']) : null,
    ]),
  ]))

  sections.push(el('div', { class: 'sheet-section' }, [
    el('div', { class: 'sheet-section-title' }, ['偏好与通知']),
    settingsToggleRow('深色模式', '跟随系统或手动切换浅色/深色主题', isDarkTheme(), () => toggleTheme()),
    settingsToggleRow('任务完成通知', '宿主上任一会话完成任务时发送通知与提示音', runtime.notificationsEnabled, async (v) => {
      if (v) {
        try {
          unlockAudio()
          const p = await Notification.requestPermission()
          if (p === 'granted') {
            runtime.notificationsEnabled = true
            try { localStorage.setItem('dsh-mp-notify', 'true') } catch {}
            alert('通知与提示音已开启！')
          } else {
            alert('请在系统或浏览器设置中允许通知权限。')
          }
        } catch (e) {
          console.error(e)
        }
      } else {
        runtime.notificationsEnabled = false
        try { localStorage.setItem('dsh-mp-notify', 'false') } catch {}
      }
      syncSheetPortal(true)
    }),
    el('button', {
      type: 'button',
      class: 'sheet-nav-row',
      'aria-haspopup': 'dialog',
      'aria-label': '试听通知与提示音',
      onclick: () => { void previewNotification() },
    }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['试听通知与提示音']),
        el('span', { class: 'sheet-toggle-desc' }, ['立即播放提示音并发送一条测试通知']),
      ]),
      el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['♪']),
    ]),
  ]))

  const hostName = window.location.hostname
  const isLanConnection = hostName === '127.0.0.1' || hostName === 'localhost' || /^192\.168\./.test(hostName) || /^10\./.test(hostName) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostName)

  sections.push(el('div', { class: 'sheet-section' }, [
    el('div', { class: 'sheet-section-title' }, ['网络与连接']),
    el('div', { class: 'sheet-nav-row' }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, [isLanConnection ? '🟢 局域网直连 (Wi-Fi/热点)' : '🌐 公网远程 (Cloud Tunnel)']),
        el('span', { class: 'sheet-toggle-desc' }, [isLanConnection ? '极速低延迟通道 · 局域网物理直连' : '随时随地远程访问通道']),
      ]),
      el('span', { class: 'sheet-badge', style: 'font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--m-surface-2, rgba(255,255,255,0.08)); color: var(--m-text-secondary, #a1a1aa);' }, [isLanConnection ? '局域网' : '公网']),
    ]),
  ]))

  sections.push(el('div', { class: 'sheet-section' }, [
    el('div', { class: 'sheet-section-title' }, ['系统与维护']),
    el('button', {
      type: 'button',
      class: 'sheet-nav-row',
      'aria-label': '刷新前端页面',
      onclick: () => reloadApp(),
    }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['刷新前端页面']),
        el('span', { class: 'sheet-toggle-desc' }, ['加到主屏幕 PWA 或卡住时点此刷新']),
      ]),
      el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['↻']),
    ]),
    el('button', {
      type: 'button',
      class: 'sheet-nav-row',
      'aria-label': '添加到主屏幕指南',
      onclick: () => switchSheet('pwa'),
    }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['添加到主屏幕 (PWA)']),
        el('span', { class: 'sheet-toggle-desc' }, ['全屏独立 App 安装指南']),
      ]),
      el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['›']),
    ]),
    el('button', {
      type: 'button',
      class: 'sheet-nav-row',
      style: 'color: var(--m-danger);',
      'aria-label': '重启核心服务',
      onclick: () => {
        if (!window.confirm('确定要重启 DSH 服务端吗？\n\n这会中断所有正在运行的任务。如果你的宿主不是通过常驻进程运行的，可能需要去终端手动重新启动。')) return
        closeSheet()
        void call('host.restart', {}).then((res) => {
          if (!res.ok) alert('重启请求失败: ' + (res.error?.message || '未知错误'))
          else setTimeout(() => reloadApp(), 1500)
        }).catch((err) => alert('发送重启指令失败: ' + err.message))
      },
    }, [
      el('div', { class: 'sheet-toggle-copy' }, [
        el('span', { class: 'sheet-toggle-title' }, ['重启核心服务']),
        el('span', { class: 'sheet-toggle-desc' }, ['重新加载宿主配置与后端插件']),
      ]),
      el('span', { class: 'sheet-nav-chevron', 'aria-hidden': 'true' }, ['⟳']),
    ]),
  ]))

  return el('div', { class: 'sheet-backdrop', onclick: () => closeSheet() }, [
    el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '设置与控制', onclick: (ev) => { ev.stopPropagation() } }, [
      el('div', { class: 'sheet-handle' }),
      el('div', { class: 'sheet-title' }, ['设置与控制']),
      el('div', { class: 'sheet-body' }, sections),
    ]),
  ])
}
