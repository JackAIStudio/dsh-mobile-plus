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
import { syncSheetPortal } from '../sheets.js'
import { loadDefaultModel } from '../sheets/model-catalog.js'
import { loadQuota } from '../../net/quota.js'
import { ensureMux, ensureHost } from '../../net/mux.js'
import { restoreRoute, leaveBootForRecent } from '../../state/route.js'
import { startPendingPoll, stopPendingPoll } from '../../net/pending.js'
import { loadSlashCatalog } from '../../chat/slash.js'
import { boot } from '../../app.js'
import { cleanPairUrl } from '../../net/pair.js'

export async function enterApp() {
    cleanPairUrl()
    state.error = ''
    state.loading = true
    // Start from a clean slate: a previous render error must not short-circuit
    // the views we are about to build.
    if (state.view === 'error') state.view = 'boot'
    runtime.bootEntered = true
    if (state.view !== 'boot') {
      state.view = 'boot'
      render()
    }
    try {
      void probeToday()
      await Promise.all([
        loadWorkspaces(),
        loadPresets(),
        loadDefaultModel(),
        ensureMux(),
        ensureHost(),
      ])
      startListPoll()
      void loadQuota(false)
      void loadSlashCatalog()
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
    try {
      renderView()
    } catch (err) {
      // A view builder that throws must not leave the phone on a blank page.
      // Keep the reason on screen and give the reader a way out; the next
      // successful render replaces it.
      state.error = String((err && err.message) || err || '界面渲染失败')
      state.view = 'error'
      state.loading = false
      rootEl.replaceChildren(el('main', { class: 'mobile mobile-empty' }, [
        el('p', { class: 'mobile-error', role: 'alert' }, [state.error]),
        el('button', { type: 'button', class: 'mobile-new', onclick: () => void boot() }, ['重试']),
        el('button', { type: 'button', class: 'mobile-button', onclick: () => reloadApp() }, ['刷新页面']),
      ]))
    }
    try {
      syncSheetPortal()
    } catch {
      /* the sheet is optional; a broken one must not hide the page */
    }
  }

function renderView() {
    if (state.view !== 'chat') {
      abandonComposerIme()
      closeImageLightbox()
    }
    if (state.view === 'boot') {
      rootEl.replaceChildren(el('main', { class: 'mobile mobile-empty' }, [
        el('p', { class: 'mobile-muted' }, [state.bootMessage || '正在连接…']),
        el('button', {
          type: 'button',
          class: 'mobile-button',
          onclick: () => leaveBootForRecent(),
        }, [runtime.preferRecent ? '刷新并进入' : '最近会话']),
      ]))
    } else if (state.view === 'error') {
      rootEl.replaceChildren(el('main', { class: 'mobile mobile-empty' }, [
        el('p', { class: 'mobile-error', role: 'alert' }, [state.error || '无法连接到运行中的 DSH host。']),
        el('button', { type: 'button', class: 'mobile-new', onclick: () => void boot() }, ['重试']),
        el('button', { type: 'button', class: 'mobile-button', onclick: () => reloadApp() }, ['刷新页面']),
      ]))
    } else if (state.view === 'pair') {
      rootEl.replaceChildren(renderPair())
    } else if (state.view === 'workspaces') {
      rootEl.replaceChildren(renderWorkspaces())
    } else if (state.view === 'dir') {
      rootEl.replaceChildren(renderDir())
    } else if (state.view === 'sessions') {
      captureListScroll()
      const page = renderSessions()
      rootEl.replaceChildren(page)
      applyListScroll(page.querySelector('.mobile-list'))
    } else if (state.view === 'chat') {
      if (runtime.imeComposing) {
        runtime.composerRenderQueued = true
      } else {
        applyChatPage()
      }
    }
  }
