/**
 * Settings, model selector, power, and PWA install bottom sheets.
 */
import { state, chat, runtime } from '../state/state.js'
import { el } from '../utils/dom.js'
import { writeStoredBoolean } from '../utils/storage.js'
import { call } from '../net/rpc.js'
import { render } from './views/render.js'
import { isStandalone, isSecurePage, isAppleMobile } from '../app.js'
import { quotaSummary } from '../net/quota.js'
import { navBack } from '../state/route.js'

export function pwaSheet() {
    const secure = isSecurePage()
    const apple = isAppleMobile()
    const canPrompt = Boolean(deferredInstallPrompt)
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
    const close = () => { state.sheet = null; render() }
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
    if (!deferredInstallPrompt) return
    const promptEvent = deferredInstallPrompt
    deferredInstallPrompt = null
    try {
      await promptEvent.prompt()
    } catch {
      /* user dismissed or the browser cancelled */
    }
    state.sheet = null
    render()
  }

export function powerSheet() {
    const close = () => { state.sheet = null; render() }
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
              void rpc('host.restart', {}).then((res) => {
                if (!res.ok) alert('重启请求失败: ' + (res.error?.message || '未知错误'))
                else setTimeout(() => reloadApp(), 1500)
              }).catch((err) => alert('发送重启指令失败: ' + err.message))
            } }, ['重启核心服务']),
          ]),
        ]),
      ]),
    ])
  }

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
          render()
        }),
        settingsToggleRow('显示系统提示', '显示宿主注入的系统提示消息', chat.showSystemMessages, (v) => {
          chat.showSystemMessages = v
          writeStoredBoolean('dsh.mobile.showSystemMessages', v)
          render()
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
          render()
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
          render()
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
      settingsToggleRow('任务完成通知', '后台任务完成时发送通知与提示音', notificationsEnabled, async (v) => {
        if (v) {
          try {
            if (!audioUnlocked) {
              const audio = document.getElementById('peon-audio');
              if (audio) { audio.volume = 0.01; audio.play().then(() => { audio.pause(); audio.volume = 1; audioUnlocked = true; }).catch(console.error); }
            }
            const p = await Notification.requestPermission();
            if (p === 'granted') {
              notificationsEnabled = true;
              try { localStorage.setItem('dsh-mp-notify', 'true'); } catch {}
              alert('通知与提示音已开启！');
            } else {
              alert('请在系统或浏览器设置中允许通知权限。');
            }
          } catch (e) {
            console.error(e);
          }
        } else {
          notificationsEnabled = false;
          try { localStorage.setItem('dsh-mp-notify', 'false'); } catch {}
        }
        render();
      }),
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
        onclick: () => {
          state.sheet = 'pwa'
          render()
        },
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
          state.sheet = null
          render()
          void rpc('host.restart', {}).then((res) => {
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

    return el('div', { class: 'sheet-backdrop', onclick: () => { state.sheet = null; state.sheetReturn = null; render() } }, [
      el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '设置与控制', onclick: (ev) => { ev.stopPropagation() } }, [
        el('div', { class: 'sheet-handle' }),
        el('div', { class: 'sheet-title' }, ['设置与控制']),
        el('div', { class: 'sheet-body' }, sections),
      ]),
    ])
  }

export function openModelSheet() {
    if (state.sheet === 'settings') state.sheetReturn = 'settings'
    state.sheet = 'model'
    chat.modelSheet = { status: 'loading' }
    chat.modelError = undefined
    render()
    void call('session.models', { sessionId: state.session.sessionId }).then(
      (data) => { chat.modelSheet = { status: 'ready', data }; render() },
      (err) => { chat.modelSheet = { status: 'error', message: String(err.message || err) }; render() },
    )
  }

export function renderModelSheet() {
    const backToSettings = () => {
      state.sheetReturn = null
      state.sheet = 'settings'
      render()
    }
    const dismiss = () => {
      state.sheetReturn = null
      state.sheet = null
      render()
    }
    const close = state.sheetReturn === 'settings' ? backToSettings : dismiss
    const sheet = (kids) => el('div', { class: 'sheet-backdrop', onclick: close }, [
      el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '模型与思考强度', onclick: (ev) => { ev.stopPropagation() } }, [
        el('div', { class: 'sheet-handle' }),
        el('div', { class: 'sheet-title sheet-title-nav' }, [
          state.sheetReturn === 'settings'
            ? el('button', { type: 'button', class: 'sheet-back', 'aria-label': '返回设置', onclick: (ev) => { ev.stopPropagation(); backToSettings() } }, ['‹'])
            : null,
          '模型与思考强度',
        ]),
        el('div', { class: 'sheet-body' }, kids),
      ]),
    ])

    const ms = chat.modelSheet
    if (ms.status === 'loading') {
      return sheet([el('div', { class: 'sheet-status' }, ['正在加载模型目录…'])])
    }
    if (ms.status === 'error') {
      return sheet([
        el('div', { class: 'sheet-status sheet-status-error' }, [
          el('span', {}, [ms.message]),
          el('button', { type: 'button', class: 'chat-load-older', onclick: () => void openModelSheet() }, ['重试']),
        ]),
      ])
    }

    const { data } = ms
    const selected = chat.currentModel ?? data.current
    const choices = (data.groups || []).flatMap((group) => group.models.map((model) => ({ group, model })))
    const currentChoice = choices.find((c) => c.group.id === selected.provider && c.model.id === selected.model)
    const reasoning = currentChoice?.model.reasoning
    const effectiveEffort = selected.reasoningEffort ?? reasoning?.defaultEffort
    const effortChoices = reasoning === undefined
      ? []
      : [
          ...(reasoning.defaultEffort === undefined
            ? [{ key: 'provider-default', effort: undefined, label: '跟随模型默认' }]
            : []),
          ...reasoning.efforts.map((effort) => ({
            key: `effort:${effort.id}`,
            effort: effort.id,
            label: effort.name,
            description: effort.description,
          })),
        ]

    const option = (isSelected, kids, onPick) => el('button', {
      type: 'button',
      class: `sheet-option${isSelected ? ' sheet-option-selected' : ''}`,
      disabled: chat.modelBusy,
      onclick: () => void onPick(),
    }, [
      el('span', { class: 'sheet-option-copy' }, kids),
      isSelected ? el('span', { class: 'sheet-option-check', 'aria-hidden': 'true' }, ['√']) : null,
    ])

    const apply = async (selection) => {
      if (chat.modelBusy) return
      chat.modelBusy = true
      chat.modelError = undefined
      render()
      try {
        const result = await call('session.selectModel', {
          sessionId: state.session.sessionId,
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
        })
        chat.modelBusy = false
        chat.currentModel = result.selected
        close()
      } catch (err) {
        chat.modelBusy = false
        chat.modelError = String(err.message || err)
        render()
      }
    }

    const kids = []
    if (chat.modelError !== undefined) kids.push(el('p', { class: 'sheet-error' }, [chat.modelError]))
    for (const failure of data.failures || []) {
      kids.push(el('p', { class: 'sheet-error' }, [`${failure.name}: ${failure.message}`]))
    }
    if ((data.groups || []).length === 0 && choices.length === 0) {
      kids.push(el('div', { class: 'sheet-status' }, ['没有可用的模型']))
    }
    for (const group of data.groups || []) {
      const rows = group.models.map((model) => {
        const isSelected = selected.provider === group.id && selected.model === model.id
        return option(isSelected, [
          el('span', { class: 'sheet-option-title' }, [model.name]),
          model.description !== undefined ? el('span', { class: 'sheet-option-desc' }, [model.description]) : null,
        ], () => apply({
          provider: group.id,
          model: model.id,
          ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
        }))
      })
      kids.push(el('div', { class: 'sheet-section' }, [
        el('div', { class: 'sheet-section-title' }, [group.name]),
        ...rows,
      ]))
    }
    if (effortChoices.length > 0) {
      kids.push(el('div', { class: 'sheet-section' }, [
        el('div', { class: 'sheet-section-title' }, ['思考强度']),
        ...effortChoices.map((choice) => option(effectiveEffort === choice.effort, [
          el('span', { class: 'sheet-option-title' }, [choice.label]),
          choice.description !== undefined ? el('span', { class: 'sheet-option-desc' }, [choice.description]) : null,
        ], () => apply({
          provider: selected.provider,
          model: selected.model,
          ...(choice.effort !== undefined ? { reasoningEffort: choice.effort } : {}),
        }))),
      ]))
    }
    return sheet(kids)
  }
