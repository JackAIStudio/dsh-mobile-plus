/**
 * Chat conversation view, scroll restoration, and message history.
 */
import { state, chat, runtime } from '../../state/state.js'
import { el } from '../../utils/dom.js'
import { call } from '../../net/rpc.js'
import { commitLocation, navBack, persistRoute } from '../../state/route.js'
import { EventFolder, foldEvents, toWireEvent, seedSessionTitleFromPage } from '../../chat/fold.js'
import { seedTodosFromPage, renderTodoDock } from '../todo.js'
import { messageHtml, isHiddenSystemMessage } from '../markdown.js'
import { renderApprovalPanel, renderQuestionPanel } from '../../chat/approvals.js'
import { removeComposerImage } from '../../chat/upload.js'
import { renderSlashMenu, loadSlashCatalog } from '../../chat/slash.js'
import { ensureComposer, buildInputbar, syncInputbar, syncComposerDraft } from '../../chat/composer.js'
import { composerSrc, openImageLightbox } from '../lightbox.js'
import { headerIcon, themeToggle, reloadButton, headerActions, pwaButton, globalSettingsButton } from '../theme.js'
import { stopMuxObservation } from '../../net/mux.js'
import { render } from './render.js'

let lastMsgScrollKey = ''
let prependAdjust = null

export async function loadTail() {
    const sid = state.session && state.session.sessionId
    if (!sid) return
    chat.loading = true
    chat.tailLoading = true
    chat.liveBuffer = []
    chat.overflow = false
    chat.folder = null
    chat.messages = []
    render()
    try {
      const page = await call('session.history', { sessionId: sid, maxMessages: 30 })
      if (state.session?.sessionId !== sid) return
      // Buffered live events re-fold on top of the snapshot; the watermark
      // drops any the snapshot already includes, so nothing is lost or doubled.
      const buffered = chat.liveBuffer
      chat.liveBuffer = []
      chat.tailLoading = false
      const folder = new EventFolder(foldEvents((page.events || []).map(toWireEvent)))
      chat.folder = folder
      chat.messages = folder.fold(buffered)
      chat.hasOlder = Boolean(page.hasMore)
      seedTodosFromPage(sid, page, buffered)
      seedSessionTitleFromPage(sid, page)
      reconcileOutbox(sid)
      state.error = ''
      // The buffer overflowed while waiting (oldest events were dropped), so
      // re-pull the freshest history page to close the gap on top of what is
      // already rendered. Best-effort: a failure here only ignores, it must
      // not replace the loaded state with an error.
      if (chat.overflow) {
        chat.overflow = false
        try {
          const fresh = await call('session.history', { sessionId: sid, maxMessages: 30 })
          if (state.session?.sessionId !== sid) return
          chat.messages = folder.fold((fresh.events || []).map(toWireEvent))
          seedTodosFromPage(sid, fresh)
          seedSessionTitleFromPage(sid, fresh)
          reconcileOutbox(sid)
        } catch { /* best-effort */ }
      }
    } catch (err) {
      if (state.session?.sessionId !== sid) return
      // Load failed: flush the buffer so the live stream still renders.
      const buffered = chat.liveBuffer
      chat.liveBuffer = []
      chat.tailLoading = false
      if (chat.folder === null) chat.folder = new EventFolder()
      if (buffered.length > 0) chat.messages = chat.folder.fold(buffered)
      chat.todos = applyTodoEventsAfter([], buffered)
      reconcileOutbox(sid)
      state.error = String(err.message || err)
    } finally {
      if (state.session?.sessionId !== sid) return
      chat.loading = false
      render()
    }
  }

export async function loadOlder() {
    const oldest = chat.messages[0]
    if (!oldest) return
    try {
      const page = await call('session.history', {
        sessionId: state.session.sessionId,
        maxMessages: 30,
        beforeSeq: Math.max(1, oldest.seq - 1),
      })
      const existing = document.querySelector('.chat-scroll')
      prependAdjust = existing
        ? { height: existing.scrollHeight, top: existing.scrollTop }
        : null
      chatScroll.stick = false
      const olderMsgs = foldEvents((page.events || []).map(toWireEvent))
      chat.folder.prepend(olderMsgs)
      chat.messages = chat.folder.snapshot()
      chat.hasOlder = Boolean(page.hasMore)
      render()
    } catch (err) {
      prependAdjust = null
      state.error = String(err.message || err)
      render()
    }
  }

export async function openChat(session, opts = {}) {
    const q = ++chatQuery
    state.session = session
    state.view = 'chat'
    setDraft('')
    clearAttachments()
    state.sending = false
    lastMsgScrollKey = null
    chatScroll.stick = true
    chatScroll.top = 0
    chatScroll.restoring = false
    todoScroll.top = 0
    todoScroll.stick = true
    todoWatermark.delete(session.sessionId)
    chat.todos = null
    chat.approvals = []
    chat.questions = []
    const live = ensureLive(session.sessionId)
    live.completed = false
    state.running = live.running === true || session.running === true
    const mode = opts.locationMode || 'push'
    if (state.workspace && state.workspace.workspaceId) {
      const loc = { view: 'chat', workspaceId: state.workspace.workspaceId, sessionId: session.sessionId }
      if (mode !== 'none') commitLocation(loc, mode)
      else persistRoute(loc)
    }
    render()
    if (q !== chatQuery) return
    await ensureMux()
    if (q !== chatQuery) return
    mux.observe(session.sessionId)
    // Best-effort current model for the settings row (the sheet re-reads the
    // directory on every open) — old-plugin parity.
    void call('session.models', { sessionId: session.sessionId }).then((data) => {
      if (q !== chatQuery) return
      chat.currentModel = data.current
      if (state.view === 'chat') render()
    }).catch(() => { /* settings row falls back to a plain label */ })
    void loadSlashCatalog(session.sessionId)
    startPendingPoll()
    // loadTail 内部完成时会 render（贴底 rAF 指向它构建的 scroller）；
    // 这里不能再 render 一次——那会让上一个 rAF 失效并恢复 prevTop=0（Bug #1042）
    await loadTail()
  }

export function renderChatParts() {
    // Opening a session (null key) pins to the bottom. After that, stick only
    // while the user is already near the bottom — never yank a reader back to
    // the top, and never fight a deliberate upward scroll.
    const localPending = openOutbox()
    const last = localPending.length ? localPending[localPending.length - 1] : chat.messages[chat.messages.length - 1]
    const lastId = last === undefined ? undefined : last.id
    if (lastMsgScrollKey === null) chatScroll.stick = true
    if (lastId !== undefined) lastMsgScrollKey = lastId

    const scroller = el('div', { class: 'chat-scroll', onscroll: onChatScroll })
    if (chat.hasOlder) {
      scroller.append(el('button', { type: 'button', class: 'chat-load-older', onclick: () => void loadOlder() }, ['加载更早消息']))
    }
    if (chat.loading && chat.messages.length === 0 && localPending.length === 0) {
      scroller.append(el('div', { class: 'chat-typing' }, ['加载中…']))
    }
    let visible = 0
    for (const m of chat.messages) {
      if (isHiddenSystemMessage(m)) continue
      visible += 1
      scroller.append(messageHtml(m))
    }
    for (const m of localPending) {
      visible += 1
      scroller.append(messageHtml(m))
    }
    if (visible === 0 && !chat.loading) {
      scroller.append(el('div', { class: 'chat-typing' }, ['还没有消息，发一句试试']))
    }
    for (const approval of chat.approvals) scroller.append(renderApprovalPanel(approval))
    for (const group of chat.questions) scroller.append(renderQuestionPanel(group))

    const pics = state.attachments.length
      ? el('div', { class: 'composer-pics' }, state.attachments.map((att) => {
          const remove = el('button', {
            type: 'button',
            class: 'composer-pic-remove',
            'aria-label': '移除附件',
            onclick: (ev) => { ev.stopPropagation(); removeAttachment(att.id) },
          }, ['×'])
          const overlay = att.status === 'uploading'
            ? el('div', { class: 'composer-pic-progress' }, [`${Math.round((att.progress || 0) * 100)}%`])
            : att.status === 'failed'
              ? el('div', { class: 'composer-pic-progress' }, ['失败'])
              : null
          if (isImageAttachment(att) && att.preview) {
            return el('div', { class: `composer-pic${att.status === 'failed' ? ' is-failed' : ''}` }, [
              el('button', {
                type: 'button',
                class: 'composer-pic-open',
                'aria-label': att.name ? `放大查看 ${att.name}` : '放大查看即将发送的图片',
                onclick: () => openImageLightbox(att.preview),
              }, [el('img', { src: att.preview, alt: att.name || '' })]),
              overlay,
              remove,
            ])
          }
          return el('div', { class: `composer-file${att.status === 'failed' ? ' is-failed' : ''}` }, [
            el('div', { class: 'composer-file-name' }, [att.name || '文件']),
            el('div', { class: 'composer-file-meta' }, [
              att.status === 'uploading'
                ? `上传 ${Math.round((att.progress || 0) * 100)}%`
                : att.status === 'failed'
                  ? (att.error || '失败')
                  : formatBytes(att.size),
            ]),
            remove,
          ])
        }))
      : null

    return {
      header: el('header', { class: 'mobile-header' }, [
        el('button', {
          type: 'button',
          class: 'mobile-back',
          'aria-label': '返回',
          onclick: () => navBack(state.listMode === 'flat' ? { view: 'sessions' } : (state.workspace ? { view: 'sessions', workspaceId: state.workspace.workspaceId } : { view: 'workspaces' }))
        }, ['‹']),
        el('h1', {
          class: 'mobile-title mobile-titleInline',
          title: state.session ? sessionTitle(state.session) : '聊天',
        }, [state.session ? sessionTitle(state.session) : '聊天']),
        headerActions([
          renderQuotaBar(),
          globalSettingsButton(),
        ]),
      ]),
      error: state.error ? el('p', { class: 'mobile-error mobile-pad' }, [state.error]) : null,
      status: state.running ? el('div', { class: 'chat-turn-status' }, [
        el('span', { class: 'chat-turn-dots' }, [el('span'), el('span'), el('span')]),
        '正在输出',
      ]) : null,
      scroller,
      todos: renderTodoDock(standingTodos()),
      pics,
      slash: renderSlashMenu(),
      sheet: state.sheet === 'model' ? renderModelSheet() : state.sheet === 'settings' ? settingsSheet() : state.sheet === 'quota' ? quotaSheet() : state.sheet === 'power' ? powerSheet() : state.sheet === 'pwa' ? pwaSheet() : null,
    }
  }

export function chatAboveBar(parts) {
    return [parts.header, parts.error, parts.status, parts.scroller, parts.todos, parts.pics, parts.slash].filter(Boolean)
  }

export function applyChatPage() {
    captureChatScroll()
    captureTodoScroll()
    const parts = renderChatParts()
    const above = chatAboveBar(parts)
    let page = rootEl.querySelector(':scope > .mobile.chat')
    if (!page) {
      page = el('div', { class: 'mobile chat' }, [...above, buildInputbar(), parts.sheet])
      rootEl.replaceChildren(page)
    } else {
      const liveBar = page.querySelector(':scope > .chat-inputbar')
      for (const child of [...page.children]) {
        if (child !== liveBar) child.remove()
      }
      if (liveBar) {
        for (const node of above) page.insertBefore(node, liveBar)
        syncInputbar(liveBar)
      } else {
        for (const node of above) page.append(node)
        page.append(buildInputbar())
      }
      if (parts.sheet) page.append(parts.sheet)
    }
    applyChatScroll(page.querySelector('.chat-scroll'))
    applyTodoScroll(page.querySelector('.todo-dock-list'))
  }
