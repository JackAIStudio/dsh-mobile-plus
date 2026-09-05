/**
 * Bottom sheet for picking a workspace to create a new session.
 */
import { state } from '../../state/state.js'
import { el, workspaceTitle, abbreviateHomePath } from '../../utils/dom.js'
import { closeSheet, syncSheetPortal } from './portal.js'
import { createSessionInWorkspace } from '../views/session-create.js'
import { enterDir } from '../views/dir-view.js'

let filterQuery = ''

export function openWorkspacePickerSheet() {
  filterQuery = ''
  state.sheet = 'workspace-pick'
  syncSheetPortal()
}

export function renderWorkspacePickerSheet() {
  const dismiss = () => {
    closeSheet()
  }

  const getFilteredWorkspaces = () => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return state.workspaces || []
    return (state.workspaces || []).filter((ws) => {
      const name = workspaceTitle(ws).toLowerCase()
      const path = (ws.path || '').toLowerCase()
      return name.includes(q) || path.includes(q)
    })
  }

  const listContainer = el('div', { class: 'sheet-ws-list' })

  const updateList = () => {
    const list = getFilteredWorkspaces()
    const items = list.map((ws) => {
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
    })
    if (items.length === 0) {
      listContainer.replaceChildren(el('p', { class: 'mobile-muted', style: 'padding: 16px; text-align: center;' }, ['没有匹配的工作区']))
    } else {
      listContainer.replaceChildren(...items)
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
