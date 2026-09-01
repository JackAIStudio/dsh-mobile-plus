/**
 * Chat composer input bar, IME handling, and keydown listeners.
 */
import { state, chat, runtime } from '../state/state.js'
import { el } from '../utils/dom.js'
import { send, stopTurn } from './outbox.js'
import { pickFromFiles } from './upload.js'
import { renderSlashMenu } from './slash.js'
import { render } from '../ui/views/render.js'

export function contextUsage() {
    for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
      const message = chat.messages[i]
      if (message.kind !== 'assistant' || !message.usage) continue
      const windowSize = message.contextWindow
      if (!windowSize || windowSize <= 0) continue
      const tokens = message.usage.inputTokens + (message.usage.cacheReadTokens || 0) + (message.usage.cacheWriteTokens || 0)
      return Math.round(tokens / windowSize * 100)
    }
    return undefined
  }

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
      ensureComposer(),
      makeAttachButton(),
      makeSendButton(),
    ])
  }

export function syncInputbar(bar) {
    if (!bar) return
    const send = makeSendButton()
    const oldSend = bar.querySelector('.chat-send')
    if (
      !oldSend
      || oldSend.className !== send.className
      || oldSend.disabled !== send.disabled
      || oldSend.textContent !== send.textContent
    ) {
      if (oldSend) oldSend.replaceWith(send)
      else bar.append(send)
    }
    syncComposerDraft(ensureComposer(), state.draft, false)
    const attach = makeAttachButton()
    const oldAttach = bar.querySelector('.attach-btn')
    if (
      !oldAttach
      || oldAttach.className !== attach.className
      || oldAttach.disabled !== attach.disabled
      || oldAttach.getAttribute('aria-expanded') !== attach.getAttribute('aria-expanded')
    ) {
      if (oldAttach) oldAttach.replaceWith(attach)
      else bar.insertBefore(attach, bar.querySelector('.chat-send'))
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
