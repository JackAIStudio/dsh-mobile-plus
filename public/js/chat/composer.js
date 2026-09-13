/**
 * Chat composer input bar, IME handling, and keydown listeners.
 */
import { state, runtime } from '../state/state.js'
import { el } from '../utils/dom.js'
import { send, stopTurn } from './outbox.js'
import { pickFromFiles } from './upload.js'
import { renderSlashMenu } from './slash.js'
import { contextUsage } from './context-usage.js'
import { render } from '../ui/views/render.js'

export function autosizeInput(node) {
    if (!node || runtime.imeComposing) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 120)}px`
  }

export function imeLocked(ev) {
    return runtime.imeComposing || Boolean(ev && (ev.isComposing || ev.keyCode === 229))
  }

export function flushComposerRender() {
    if (!runtime.composerRenderQueued) return
    runtime.composerRenderQueued = false
    if (state.view === 'chat') render()
  }

export function syncComposerDraft(node, next, force) {
    if (!node) return
    if (!force && runtime.imeComposing) return
    if (node.value === next) return
    node.value = next
  }

export function setDraft(next) {
    state.draft = next == null ? '' : String(next)
    syncComposerDraft(runtime.composerNode, state.draft, true)
    autosizeInput(runtime.composerNode)
  }

export function onComposerInput(ev) {
    const node = ev.target
    if (ev.isComposing || ev.inputType === 'insertCompositionText') runtime.imeComposing = true
    const prev = state.draft
    state.draft = node.value
    if (imeLocked(ev)) return
    autosizeInput(node)
    if (state.draft.startsWith('/') || prev.startsWith('/')) render()
  }

export function onComposerKeydown(ev) {
    if (composerReturnIsNewline()) return
    if (imeLocked(ev)) return
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      void send()
    }
  }

export function ensureComposer() {
    if (runtime.composerNode) return runtime.composerNode
    runtime.composerNode = el('textarea', {
      class: 'chat-input',
      placeholder: '输入消息，/ 调用命令或技能',
      enterkeyhint: composerReturnIsNewline() ? 'enter' : 'send',
      autocomplete: 'off',
      oninput: onComposerInput,
      onkeydown: onComposerKeydown,
    })
    runtime.composerNode.value = state.draft
    return runtime.composerNode
  }

export function makeSendButton() {
    return state.running
      ? el('button', { type: 'button', class: 'chat-send chat-send-stop', disabled: state.sending, onclick: () => void stopTurn() }, ['■'])
      : el('button', { type: 'button', class: 'chat-send', disabled: state.sending, onclick: () => void send() }, [state.sending ? '发送中…' : '发送'])
  }

export function makeContextUsageButton() {
    const pct = contextUsage()
    const hasPct = pct !== undefined
    const isWarn = hasPct && pct >= 80
    const isDanger = hasPct && pct >= 95
    const pctClass = isDanger ? ' is-danger' : (isWarn ? ' is-warn' : '')
    const pctDisplay = hasPct ? `${pct}%` : '—'
    const isCompact = hasPct && pct >= 100
    const isEmpty = !hasPct

    const radius = 12
    const circumference = 75.4
    const offset = hasPct
      ? Math.max(0, circumference - (circumference * Math.min(100, pct)) / 100)
      : circumference

    const title = hasPct
      ? `上下文占用 ${pct}% (点击查看详情)`
      : '上下文占用情况 (点击查看详情)'

    return el('button', {
      type: 'button',
      class: `context-usage-btn${pctClass}`,
      'data-pct': hasPct ? String(pct) : 'none',
      'aria-label': hasPct ? `上下文已占用 ${pct}%，点击查看详情` : '上下文占用情况，点击查看详情',
      title,
      onclick: (ev) => {
        ev.preventDefault()
        state.sheetReturn = null
        state.sheet = state.sheet === 'settings' ? null : 'settings'
        render()
      },
    }, [
      el('span', {
        class: 'context-usage-ring',
        'aria-hidden': 'true',
        html: `<svg viewBox="0 0 32 32" class="context-usage-svg">
          <circle cx="16" cy="16" r="${radius}" class="ctx-ring-bg" />
          <circle cx="16" cy="16" r="${radius}" class="ctx-ring-meter" style="stroke-dasharray:${circumference};stroke-dashoffset:${offset.toFixed(1)}" />
          <text x="16" y="16" class="ctx-ring-text${isCompact ? ' is-compact' : ''}${isEmpty ? ' is-empty' : ''}">${pctDisplay}</text>
        </svg>`,
      }),
    ])
  }

export function makeSlashButton() {
    return makeContextUsageButton()
  }

export function makeAttachButton() {
    return el('button', {
      type: 'button',
      class: 'attach-btn',
      'aria-label': '添加附件',
      disabled: state.sending,
      onclick: () => { pickFromFiles() },
    }, [
      el('span', {
        class: 'attach-btn-icon',
        'aria-hidden': 'true',
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 1 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.82-2.83l8.49-8.48"/></svg>',
      }),
    ])
  }

export function buildInputbar() {
    return el('div', { class: 'chat-inputbar' }, [
      el('div', { class: 'chat-input-main' }, [
        ensureComposer(),
      ]),
      el('div', { class: 'chat-input-tools' }, [
        el('div', { class: 'chat-input-tools-left' }, [
          makeContextUsageButton(),
          makeAttachButton(),
        ]),
        el('div', { class: 'chat-input-tools-right' }, [
          makeSendButton(),
        ]),
      ]),
    ])
  }

export function syncInputbar(bar) {
    if (!bar) return
    if (!bar.querySelector('.chat-input-tools')) {
      const fresh = buildInputbar()
      bar.replaceWith(fresh)
      return
    }
    const send = makeSendButton()
    const oldSend = bar.querySelector('.chat-send')
    if (
      !oldSend
      || oldSend.className !== send.className
      || oldSend.disabled !== send.disabled
      || oldSend.textContent !== send.textContent
    ) {
      if (oldSend) oldSend.replaceWith(send)
      else {
        const right = bar.querySelector('.chat-input-tools-right')
        if (right) right.append(send)
        else bar.append(send)
      }
    }
    syncComposerDraft(ensureComposer(), state.draft, false)

    const ctxBtn = makeContextUsageButton()
    const oldCtxBtn = bar.querySelector('.context-usage-btn') || bar.querySelector('.slash-trigger-btn')
    if (
      !oldCtxBtn
      || oldCtxBtn.className !== ctxBtn.className
      || oldCtxBtn.dataset.pct !== ctxBtn.dataset.pct
    ) {
      if (oldCtxBtn) oldCtxBtn.replaceWith(ctxBtn)
      else {
        const left = bar.querySelector('.chat-input-tools-left')
        if (left) left.prepend(ctxBtn)
        else bar.prepend(ctxBtn)
      }
    }

    const attach = makeAttachButton()
    const oldAttach = bar.querySelector('.attach-btn')
    if (
      !oldAttach
      || oldAttach.className !== attach.className
      || oldAttach.disabled !== attach.disabled
      || oldAttach.getAttribute('aria-expanded') !== attach.getAttribute('aria-expanded')
    ) {
      if (oldAttach) oldAttach.replaceWith(attach)
      else {
        const left = bar.querySelector('.chat-input-tools-left')
        if (left) left.append(attach)
        else bar.append(attach)
      }
    }
  }

export function abandonComposerIme() {
    runtime.imeComposing = false
    runtime.composerRenderQueued = false
  }

export function composerReturnIsNewline() {
    const ua = navigator.userAgent || ''
    if (/iPhone|iPod|Android.+Mobile/i.test(ua)) return true
    if (/iPad/i.test(ua)) return true
    if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) return true
    try {
      if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true
    } catch {
      /* ignore */
    }
    return false
  }

export function focusComposer() {
    const input = document.querySelector('.chat-input')
    if (input) input.focus({ preventScroll: true })
  }
