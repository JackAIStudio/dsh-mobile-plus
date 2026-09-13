/**
 * Tool call aggregation, compact streaming capsule, and accordion.
 * Groups consecutive pure tool steps into a unified, space-saving card.
 */
import { state, chat } from '../state/state.js'
import { el } from '../utils/dom.js'
import { isImageTool } from '../chat/tool-image.js'
import { parseTodos } from './todo.js'

// Track user-toggled open/close state across live re-renders.
const openGroupIds = new Set()

export function isPureToolMessage(m) {
  if (!m || m.kind !== 'assistant') return false
  if (m.reasoning && m.reasoning.trim()) return false
  if (m.text && m.text.trim()) return false
  if (m.failed) return false
  if (!Array.isArray(m.tools) || m.tools.length === 0) return false
  return true
}

export function extractToolDescription(tool) {
  if (!tool) return ''
  if (tool.arguments) {
    try {
      const parsed = JSON.parse(tool.arguments)
      if (typeof parsed.description === 'string' && parsed.description.trim()) {
        return parsed.description.trim()
      }
      if (typeof parsed.command === 'string' && parsed.command.trim()) {
        const cmd = parsed.command.trim().split('\n')[0]
        return cmd.length > 50 ? `${cmd.slice(0, 48)}…` : cmd
      }
      if (typeof parsed.file_path === 'string' && parsed.file_path.trim()) {
        return `读取 ${parsed.file_path.split('/').pop()}`
      }
      if (typeof parsed.path === 'string' && parsed.path.trim()) {
        return `操作 ${parsed.path.split('/').pop()}`
      }
      if (typeof parsed.pattern === 'string' && parsed.pattern.trim()) {
        return `搜索 "${parsed.pattern}"`
      }
    } catch {}
  }
  return tool.name || '工具'
}

export function groupConversationItems(messages) {
  const items = []
  let currentGroup = null

  function flushGroup() {
    if (!currentGroup) return
    if (currentGroup.tools.length > 0) {
      items.push({ kind: 'tool-group', group: currentGroup, id: currentGroup.id })
    }
    currentGroup = null
  }

  for (const m of messages) {
    if (isPureToolMessage(m)) {
      const imageTools = []
      const todoTools = []
      const otherTools = []

      for (const t of m.tools) {
        if (isImageTool(t)) {
          imageTools.push(t)
        } else if (t.name === 'todo_write') {
          const parsed = parseTodos(t.arguments)
          if (parsed) todoTools.push(parsed)
          else otherTools.push(t)
        } else {
          otherTools.push(t)
        }
      }

      if (otherTools.length > 0) {
        if (!currentGroup) {
          currentGroup = {
            id: `tool-group-${m.id}`,
            tools: [],
            isRunning: false,
            time: m.time,
            firstMsgId: m.id,
          }
        }
        currentGroup.tools.push(...otherTools)
        if (m.pending || otherTools.some((t) => t.status === 'running')) {
          currentGroup.isRunning = true
        }
        currentGroup.time = m.time
      }

      if (imageTools.length > 0) {
        flushGroup()
        for (const imgTool of imageTools) {
          items.push({ kind: 'image-tool', tool: imgTool, id: `${m.id}-${imgTool.callId || 'img'}` })
        }
      }
      if (todoTools.length > 0) {
        flushGroup()
        for (const todos of todoTools) {
          items.push({ kind: 'todo', todos, id: `${m.id}-todo` })
        }
      }
      continue
    }

    flushGroup()
    items.push({ kind: 'message', message: m, id: m.id })
  }

  flushGroup()
  return items
}

function renderToolDetailItem(tool) {
  const isErr = tool.status === 'error' || Boolean(tool.errorText)
  const isRun = tool.status === 'running'
  const statusText = isRun ? '执行中…' : isErr ? (tool.errorText || '失败') : '完成'
  const statusClass = isRun ? 'is-running' : isErr ? 'is-error' : 'is-ok'
  const desc = extractToolDescription(tool)

  return el('div', { class: 'chat-tool-item' }, [
    el('div', { class: 'chat-tool-item-head' }, [
      el('span', { class: 'chat-tool-item-tag' }, [tool.name || 'tool']),
      desc && desc !== tool.name ? el('span', { class: 'chat-tool-group-names' }, [desc]) : null,
      el('span', { class: `chat-tool-item-status ${statusClass}` }, [statusText]),
    ]),
    tool.arguments ? el('pre', { class: 'chat-tool-item-args' }, [tool.arguments]) : null,
  ])
}

export function renderToolGroupCard(group) {
  if (!chat.showToolCalls) return null
  if (!group || !group.tools || group.tools.length === 0) return null

  const groupId = group.id
  let isOpen = openGroupIds.has(groupId)

  const distinctNames = [...new Set(group.tools.map((t) => t.name || 'tool'))]
  const totalCount = group.tools.length
  // Only consider running if the whole session is actively running.
  const isLiveRunning = Boolean(
    state.running && (group.isRunning || group.tools.some((t) => t.status === 'running'))
  )

  // 1. Running State: show active live card + compact history bar
  if (isLiveRunning) {
    const activeTool = group.tools[group.tools.length - 1]
    const historyTools = group.tools.slice(0, -1)
    const activeDesc = extractToolDescription(activeTool)

    const historySection = historyTools.length > 0
      ? el('div', { class: 'chat-tool-history-wrap', style: 'margin-bottom: 6px;' }, [
          el('button', {
            type: 'button',
            class: 'chat-tool-history-bar',
            onclick: () => {
              isOpen = !isOpen
              if (isOpen) openGroupIds.add(groupId)
              else openGroupIds.delete(groupId)
              const histBody = document.getElementById(`${groupId}-hist`)
              if (histBody) histBody.style.display = isOpen ? 'flex' : 'none'
            },
          }, [
            el('span', {}, [`✓ 前序已完成 ${historyTools.length} 项操作`]),
            el('span', { class: 'chat-tool-group-caret' }, [isOpen ? '▴' : '▾']),
          ]),
          el('div', {
            id: `${groupId}-hist`,
            class: 'chat-tool-group-body',
            style: isOpen ? 'display: flex; margin-top: 4px;' : 'display: none;',
          }, historyTools.map(renderToolDetailItem)),
        ])
      : null

    const liveCard = el('div', { class: 'chat-tool-live-card' }, [
      el('div', { class: 'chat-tool-live-head' }, [
        el('span', { class: 'chat-tool-group-pulse' }),
        el('span', { class: 'chat-tool-live-title' }, [`正在执行 ${activeTool?.name || '工具'}: ${activeDesc}`]),
        el('span', { class: 'chat-tool-group-badge' }, [`第 ${totalCount} 步`]),
      ]),
      activeTool?.arguments ? el('pre', { class: 'chat-tool-item-args' }, [activeTool.arguments]) : null,
    ])

    return el('div', { class: 'chat-tool-group-active-container', id: groupId }, [
      historySection,
      liveCard,
    ].filter(Boolean))
  }

  // 2. Completed / Static State: ultra-compact foldable single row
  const indicator = el('span', { class: 'chat-tool-group-caret' }, ['›'])
  const namesSummary = distinctNames.join(' / ')
  const badgeText = `共 ${totalCount} 次`

  const bodyEl = el('div', {
    class: 'chat-tool-group-body',
    style: isOpen ? 'display: flex;' : 'display: none;',
  }, group.tools.map(renderToolDetailItem))

  const container = el('div', {
    class: `chat-tool-group ${isOpen ? 'is-open' : ''}`,
    id: groupId,
  }, [
    el('button', {
      type: 'button',
      class: 'chat-tool-group-head',
      'aria-label': isOpen ? '折叠工具详情' : '展开工具详情',
      onclick: () => {
        isOpen = !isOpen
        if (isOpen) openGroupIds.add(groupId)
        else openGroupIds.delete(groupId)
        container.classList.toggle('is-open', isOpen)
        bodyEl.style.display = isOpen ? 'flex' : 'none'
      },
    }, [
      el('span', { class: 'chat-tool-group-indicator' }, [indicator]),
      el('div', { class: 'chat-tool-group-title-wrap' }, [
        el('span', { class: 'chat-tool-group-title' }, ['工具调用']),
        namesSummary ? el('span', { class: 'chat-tool-group-names' }, [namesSummary]) : null,
      ]),
      el('span', { class: 'chat-tool-group-badge' }, [badgeText]),
    ]),
    bodyEl,
  ])

  return container
}
