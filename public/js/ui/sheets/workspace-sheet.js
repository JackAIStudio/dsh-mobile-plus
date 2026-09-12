/**
 * Bottom sheet for picking a workspace to create a new session.
 * Regular project workspaces are displayed prominently on top,
 * while day-based daily workspaces are collapsed into a foldable section.
 */
import { state } from '../../state/state.js'
import { el, workspaceTitle, abbreviateHomePath } from '../../utils/dom.js'
import { closeSheet, syncSheetPortal } from './portal.js'
import { createSessionInWorkspace } from '../views/session-create.js'
import { enterDir } from '../views/dir-view.js'
import {
  partitionWorkspaces,
  sortDailyWorkspaces,
  filterWorkspaces,
} from '../../utils/workspace-filter.js'

let filterQuery = ''
let dailyExpanded = false

export function openWorkspacePickerSheet() {
  filterQuery = ''
  dailyExpanded = false
  state.sheet = 'workspace-pick'
  syncSheetPortal()
}

export function renderWorkspacePickerSheet() {
  const dismiss = () => {
    closeSheet()
  }

  const listContainer = el('div', { class: 'sheet-ws-list' })

  const renderWorkspaceItem = (ws) => {
    const name = workspaceTitle(ws)
    const pathLabel = abbreviateHomePath(ws.path)
    return el('button', {
      type: 'button',
      class: 'sheet-row-btn',
      onclick: () => {
        dismiss()
        void createSessionInWorkspace(ws)
      },
    }, [
      el('span', { class: 'mobile-rowStack' }, [
        el('span', { class: 'mobile-rowTitle' }, [name]),
        pathLabel && pathLabel !== name ? el('span', { class: 'mobile-rowMeta' }, [pathLabel]) : null,
      ]),
      el('span', { class: 'mobile-chevron' }, ['+']),
    ])
  }

  const renderFoldCard = (daily) => {
    const sortedDaily = sortDailyWorkspaces(daily)
    const foldHeader = el('button', {
      type: 'button',
      class: `ws-fold-header${dailyExpanded ? ' is-expanded' : ''}`,
      onclick: () => {
        dailyExpanded = !dailyExpanded
        updateList()
      },
    }, [
      el('div', { class: 'ws-fold-title-group' }, [
        el('span', { class: 'ws-fold-icon' }, ['📅']),
        el('span', { class: 'ws-fold-title' }, ['每日工作区']),
        el('span', { class: 'ws-fold-badge' }, [String(daily.length)]),
      ]),
      el('div', { class: 'ws-fold-status' }, [
        el('span', {}, [dailyExpanded ? '收起' : '展开']),
        el('span', { class: 'ws-fold-chevron' }, ['›']),
      ]),
    ])

    const kids = [foldHeader]
    if (dailyExpanded) {
      kids.push(el('div', { class: 'ws-fold-content' }, [
        el('p', { class: 'ws-fold-hint' }, ['💡 今日工作区可在首页直接点击「今日新会话」快捷直达']),
        ...sortedDaily.map(renderWorkspaceItem),
      ]))
    }
    return el('div', { class: 'ws-fold-card' }, kids)
  }

  const updateList = () => {
    const q = filterQuery.trim()
    const allWorkspaces = state.workspaces || []

    if (!q) {
      const { projects, daily } = partitionWorkspaces(allWorkspaces)
      const elements = []

      if (projects.length > 0) {
        elements.push(...projects.map(renderWorkspaceItem))
      } else if (daily.length === 0) {
        elements.push(el('p', { class: 'mobile-muted', style: 'padding: 16px; text-align: center;' }, ['还没有工作区']))
      } else {
        elements.push(el('p', { class: 'mobile-muted', style: 'padding: 12px 14px 4px;' }, ['暂无常规项目工作区']))
      }

      if (daily.length > 0) {
        elements.push(renderFoldCard(daily))
      }

      listContainer.replaceChildren(...elements)
      return
    }

    const filtered = filterWorkspaces(allWorkspaces, q)
    if (filtered.length === 0) {
      listContainer.replaceChildren(el('p', { class: 'mobile-muted', style: 'padding: 16px; text-align: center;' }, [`没有匹配「${q}」的工作区`]))
      return
    }

    const { projects, daily } = partitionWorkspaces(filtered)
    if (projects.length > 0 && daily.length > 0) {
      listContainer.replaceChildren(
        el('div', { class: 'ws-group-title' }, ['📁 常规项目 (', String(projects.length), ')']),
        ...projects.map(renderWorkspaceItem),
        el('div', { class: 'ws-group-title' }, ['📅 每日工作区 (', String(daily.length), ')']),
        ...sortDailyWorkspaces(daily).map(renderWorkspaceItem),
      )
    } else if (daily.length > 0) {
      listContainer.replaceChildren(
        el('div', { class: 'ws-group-title' }, ['📅 每日工作区 (', String(daily.length), ')']),
        ...sortDailyWorkspaces(daily).map(renderWorkspaceItem),
      )
    } else {
      listContainer.replaceChildren(...projects.map(renderWorkspaceItem))
    }
  }

  const searchInput = el('input', {
    class: 'mobile-wsSearch sheet-search',
    type: 'search',
    placeholder: '搜索工作区…',
    value: filterQuery,
    oninput: (ev) => {
      filterQuery = ev.target.value
      updateList()
    },
  })

  const browseBtn = el('button', {
    type: 'button',
    class: 'sheet-row-btn sheet-browse-btn',
    onclick: () => {
      dismiss()
      enterDir()
    },
  }, [
    el('span', { class: 'mobile-rowStack' }, [
      el('span', { class: 'mobile-rowTitle' }, ['📂 浏览本地目录新建…']),
      el('span', { class: 'mobile-rowMeta' }, ['选择本机任意文件夹创建新工作区']),
    ]),
    el('span', { class: 'mobile-chevron' }, ['›']),
  ])

  updateList()

  return el('div', { class: 'sheet-backdrop', onclick: dismiss }, [
    el('div', {
      class: 'sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '选择工作区新建会话',
      onclick: (ev) => ev.stopPropagation(),
    }, [
      el('div', { class: 'sheet-handle' }),
      el('div', { class: 'sheet-title' }, ['选择工作区新建会话']),
      el('div', { class: 'sheet-body sheet-body-scroll' }, [
        searchInput,
        browseBtn,
        listContainer,
      ]),
    ]),
  ])
}
