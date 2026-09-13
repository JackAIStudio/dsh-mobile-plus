/**
 * Chat conversation view, scroll restoration, and message history.
 */
import { state, chat, runtime } from '../../state/state.js'
import { el, rootEl } from '../../utils/dom.js'
import { call } from '../../net/rpc.js'
import { commitLocation, navBack, persistRoute } from '../../state/route.js'
import { EventFolder, foldEvents, toWireEvent, seedSessionTitleFromPage, sessionTitle } from '../../chat/fold.js'
import { resetContextPressure, seedContextPressureFromPage } from '../../chat/context-usage.js'
import { seedTodosFromPage, renderTodoDock, renderTodoCard, applyTodoEventsAfter, standingTodos, todoWatermark } from '../todo.js'
import { renderGoalDock } from '../goal.js'
import { seedGoalFromPage, standingGoal, goalWatermark } from '../../chat/goal.js'
import { messageHtml, isHiddenSystemMessage } from '../message.js'
import { groupConversationItems, renderToolGroupCard } from '../tool-group.js'
import { renderToolImageCard } from '../../chat/tool-image.js'
import { renderApprovalPanel, renderQuestionPanel } from '../../chat/approvals.js'
import { clearAttachments, renderComposerAttachments } from '../../chat/upload.js'
import { renderSlashMenu, loadSlashCatalog } from '../../chat/slash.js'
import { ensureComposer, buildInputbar, syncInputbar, syncComposerDraft, setDraft } from '../../chat/composer.js'
import { reconcileOutbox, openOutbox } from '../../chat/outbox.js'
import { ensureLive, startPendingPoll } from '../../net/pending.js'
import { captureChatScroll, applyChatScroll, captureTodoScroll, applyTodoScroll, onChatScroll } from '../../utils/scroll.js'
import { renderChatHeader } from './chat-header.js'
import { stopMuxObservation, ensureMux } from '../../net/mux.js'
import { rememberCatalog } from '../sheets/model-catalog.js'
import { showToast } from '../../utils/toast.js'
import { syncSheetPortal } from '../sheets/portal.js'
import { openTimelineSheet } from '../sheets/timeline-sheet.js'
import { deriveTurns, renderTurnDivider } from '../../chat/timeline.js'
import { render } from './render.js'


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
      const page = await call('session.history', { sessionId: sid, maxMessages: 50 })
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
      if (runtime.mux) {
        const topSeq = typeof folder.maxSeq === 'function' ? folder.maxSeq() : undefined
        if (typeof topSeq === 'number') runtime.mux.pollWatermark.set(sid, topSeq)
      }
      seedTodosFromPage(sid, page, buffered)
      seedGoalFromPage(sid, page, buffered)
      seedSessionTitleFromPage(sid, page)
      seedContextPressureFromPage(sid, page, buffered)
      reconcileOutbox(sid)
      state.error = ''
      // The buffer overflowed while waiting (oldest events were dropped), so
      // re-pull the freshest history page to close the gap on top of what is
      // already rendered. Best-effort: a failure here only ignores, it must
      // not replace the loaded state with an error.
      if (chat.overflow) {
        chat.overflow = false
        try {
          const fresh = await call('session.history', { sessionId: sid, maxMessages: 50 })
          if (state.session?.sessionId !== sid) return
          chat.messages = folder.fold((fresh.events || []).map(toWireEvent))
          seedTodosFromPage(sid, fresh)
          seedGoalFromPage(sid, fresh)
          seedSessionTitleFromPage(sid, fresh)
          seedContextPressureFromPage(sid, fresh)
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
      if (state.sheet === 'settings') syncSheetPortal(true)
    }
  }

export async function loadOlder() {
    const oldest = chat.messages[0]
    if (!oldest || chat.loadingOlder) return
    chat.loadingOlder = true
    render()
    try {
      const page = await call('session.history', {
        sessionId: state.session.sessionId,
        maxMessages: 50,
        beforeSeq: Math.max(1, oldest.seq - 1),
      })
      const existing = document.querySelector('.chat-scroll')
      const wasNearTop = !existing || existing.scrollTop <= 80
      runtime.prependAdjust = existing
        ? { height: existing.scrollHeight, top: existing.scrollTop, wasNearTop }
        : null
      runtime.chatScroll.stick = false
      const olderMsgs = foldEvents((page.events || []).map(toWireEvent))
      const added = olderMsgs.length
      chat.folder.prepend(olderMsgs)
      chat.messages = chat.folder.snapshot()
      chat.hasOlder = Boolean(page.hasMore)
      if (added > 0) showToast(`已加载 ${added} 条更早消息`)
      else showToast('已没有更早的消息了')
    } catch (err) {
      runtime.prependAdjust = null
      state.error = String(err.message || err)
    } finally {
      chat.loadingOlder = false
      render()
    }
  }

export async function openChat(session, opts = {}) {
    const q = ++runtime.chatQuery
    state.session = session
    state.view = 'chat'
    setDraft('')
    clearAttachments()
    state.sending = false
    runtime.lastMsgScrollKey = null
    runtime.chatScroll.stick = true
    runtime.chatScroll.top = 0
    runtime.chatScroll.restoring = false
    runtime.todoScroll.top = 0
    runtime.todoScroll.stick = true
    todoWatermark.delete(session.sessionId)
    goalWatermark.delete(session.sessionId)
    resetContextPressure(session.sessionId)
    seedContextPressureFromPage(session.sessionId, { projections: session.projections })
    chat.todos = null
    chat.goal = null
    seedGoalFromPage(session.sessionId, { projections: session.projections })
    chat.approvals = []
    chat.questions = []
    const initialModel = session?.projections?.values?.modelSelection?.next
      || session?.projections?.values?.modelSelection?.lastUsed
      || (session?.blank ? state.defaultModel : undefined)
    chat.currentModel = initialModel ? { ...initialModel } : undefined
    chat.modelCatalog = undefined
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
    if (q !== runtime.chatQuery) return
    await ensureMux()
    if (q !== runtime.chatQuery) return
    runtime.mux.observe(session.sessionId)
    // Best-effort current model for the settings row (the sheet re-reads the
    // directory on every open) — old-plugin parity.
    void call('session.models', { sessionId: session.sessionId }).then((data) => {
      if (q !== runtime.chatQuery) return
      rememberCatalog(data)
      if (state.view === 'chat') render()
      if (state.sheet === 'settings' || state.sheet === 'model') syncSheetPortal(true)
    }).catch(() => { /* settings row falls back to a plain label */ })
    void loadSlashCatalog(session?.sessionId, session?.cwd)
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
    if (runtime.lastMsgScrollKey === null) runtime.chatScroll.stick = true
    if (lastId !== undefined) runtime.lastMsgScrollKey = lastId

    const scroller = el('div', { class: 'chat-scroll', onscroll: onChatScroll })
    if (chat.hasOlder) {
      const olderBtn = chat.loadingOlder
        ? el('button', { type: 'button', class: 'chat-load-older is-loading', disabled: true }, ['正在加载更早消息…'])
        : el('button', { type: 'button', class: 'chat-load-older', onclick: () => void loadOlder() }, ['加载更早消息'])
      scroller.append(olderBtn)
    }
    if (chat.loading && chat.messages.length === 0 && localPending.length === 0) {
      scroller.append(el('div', { class: 'chat-typing' }, ['加载中…']))
    }
    const turns = deriveTurns(chat.messages, localPending)
    const turnByFirstMsgId = new Map()
    for (const t of turns) {
      if (t.userMsgId) turnByFirstMsgId.set(t.userMsgId, t)
    }

    let visible = 0
    const allMsgs = [...chat.messages, ...localPending]
    const nonSystem = allMsgs.filter((m) => !isHiddenSystemMessage(m))
    const groupedItems = groupConversationItems(nonSystem)

    for (const item of groupedItems) {
      visible += 1
      if (item.kind === 'message') {
        const turn = turnByFirstMsgId.get(item.message.id)
        if (turn) scroller.append(renderTurnDivider(turn, openTimelineSheet))
        const node = messageHtml(item.message)
        node.id = item.message.id
        scroller.append(node)
      } else if (item.kind === 'tool-group') {
        const card = renderToolGroupCard(item.group)
        if (card) scroller.append(card)
      } else if (item.kind === 'image-tool') {
        const sessId = state.session?.sessionId || ''
        const card = renderToolImageCard(item.tool, sessId)
        if (card) {
          card.id = item.id
          scroller.append(card)
        }
      } else if (item.kind === 'todo') {
        const card = renderTodoCard(item.todos)
        if (card) scroller.append(card)
      }
    }
    if (visible === 0 && !chat.loading) {
      scroller.append(el('div', { class: 'chat-typing' }, ['还没有消息，发一句试试']))
    }
    for (const approval of chat.approvals) scroller.append(renderApprovalPanel(approval))
    for (const group of chat.questions) scroller.append(renderQuestionPanel(group))

    return {
      header: renderChatHeader(),
      error: state.error ? el('p', { class: 'mobile-error mobile-pad' }, [state.error]) : null,
      status: state.running ? el('div', { class: 'chat-turn-status' }, [
        el('span', { class: 'chat-turn-dots' }, [el('span'), el('span'), el('span')]),
        '正在输出',
      ]) : null,
      scroller,
      todos: renderTodoDock(standingTodos()),
      goal: renderGoalDock(standingGoal()),
      pics: renderComposerAttachments(),
      slash: renderSlashMenu(),
    }
  }

export function chatAboveBar(parts) {
    return [parts.header, parts.error, parts.status, parts.scroller, parts.todos, parts.goal, parts.pics, parts.slash].filter(Boolean)
  }

export function applyChatPage() {
    captureChatScroll()
    captureTodoScroll()
    const parts = renderChatParts()
    const above = chatAboveBar(parts)
    let page = rootEl.querySelector(':scope > .mobile.chat')
    if (!page) {
      page = el('div', { class: 'mobile chat' }, [...above, buildInputbar()])
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
    }
    applyChatScroll(page.querySelector('.chat-scroll'))
    applyTodoScroll(page.querySelector('.todo-dock-list'))
  }
