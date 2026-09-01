/**
 * Master render dispatcher for top-level views and bottom sheets.
 */
import { state, chat, runtime } from '../../state/state.js'
import { rootEl, el } from '../../utils/dom.js'
import { captureChatScroll, applyChatScroll, captureListScroll, applyListScroll, captureTodoScroll, applyTodoScroll } from '../../utils/scroll.js'
import { abandonComposerIme } from '../../chat/composer.js'
import { closeImageLightbox } from '../lightbox.js'
import { reloadApp } from '../theme.js'
import { renderWorkspaces, loadWorkspaces, loadPresets, probeToday } from './ws-view.js'
import { renderSessions, loadSessions, startListPoll } from './session-view.js'
import { applyChatPage } from './chat-view.js'
import { renderDir, renderPair } from './dir-view.js'
import { settingsSheet, renderModelSheet, pwaSheet, powerSheet } from '../sheets.js'
import { quotaSheet, loadQuota } from '../../net/quota.js'
import { ensureMux, ensureHost } from '../../net/mux.js'
import { restoreRoute } from '../../state/route.js'
import { startPendingPoll, stopPendingPoll } from '../../net/pending.js'
import { boot } from '../../app.js'

export async function enterApp() {
    state.error = ''
    state.loading = true
    if (state.view !== 'boot') {
      state.view = 'boot'
      render()
    }
    try {
      await probeToday()
      await loadWorkspaces()
      await loadPresets()
      await ensureMux()
      await ensureHost()
      startListPoll()
      void loadQuota(false)
      await restoreRoute()
      if (state.view !== 'error') state.loading = false
    } catch (err) {
      state.error = String(err.message || err)
      state.view = 'error'
      state.loading = false
      render()
    }
  }

export function render() {
    if (state.view !== 'chat') {
      abandonComposerIme()
      closeImageLightbox()
    }
    if (state.view === 'boot') {
      rootEl.replaceChildren(el('main', { class: 'mobile mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['正在连接…'])]))
      return
    }
    if (state.view === 'error') {
      rootEl.replaceChildren(el('main', { class: 'mobile mobile-empty' }, [
        el('p', { class: 'mobile-error', role: 'alert' }, [state.error || '无法连接到运行中的 DSH host。']),
        el('button', { type: 'button', class: 'mobile-new', onclick: () => void boot() }, ['重试']),
        el('button', { type: 'button', class: 'mobile-button', onclick: () => reloadApp() }, ['刷新页面']),
      ]))
      return
    }
    if (state.view === 'pair') {
      rootEl.replaceChildren(renderPair())
      return
    }
    if (state.view === 'workspaces') {
      rootEl.replaceChildren(renderWorkspaces())
      return
    }
    if (state.view === 'dir') {
      rootEl.replaceChildren(renderDir())
      return
    }
    if (state.view === 'sessions') {
      captureListScroll()
      const page = renderSessions()
      rootEl.replaceChildren(page)
      applyListScroll(page.querySelector('.mobile-list'))
      return
    }
    if (state.view === 'chat') {
      if (runtime.imeComposing) {
        runtime.composerRenderQueued = true
        return
      }
      applyChatPage()
      return
    }
  }
