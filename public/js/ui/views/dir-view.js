/**
 * Directory browser and pairing code view.
 */
import { state, runtime } from '../../state/state.js'
import { el, basename } from '../../utils/dom.js'
import { call } from '../../net/rpc.js'
import { parsePairInput, acceptPair } from '../../net/pair.js'
import { commitLocation, navBack, reloadPaired } from '../../state/route.js'
import { headerIcon, themeToggle, reloadButton, headerActions } from '../theme.js'
import { render } from './render.js'
import { loadWorkspaces } from './ws-view.js'

export function enterDir(locationMode = 'push') {
    state.dir = null
    state.dirError = ''
    state.view = 'dir'
    if (locationMode !== 'none') commitLocation({ view: 'dir' }, locationMode)
    else persistRoute({ view: 'dir' })
    render()
    void openDir()
  }

export async function openDir(path) {
    state.dir = null
    state.dirError = ''
    render()
    try {
      state.dir = await call('host.listDirectory', path === undefined ? {} : { path })
      if (state.dir && typeof state.dir.home === 'string' && state.dir.home) state.home = state.dir.home
    } catch (err) {
      state.dirError = String(err.message || err)
    }
    render()
  }

export function renderDir() {
    const dir = state.dir
    const page = el('div', { class: 'mobile dir-browser' }, [
      el('header', { class: 'mobile-header' }, [
        el('button', { type: 'button', class: 'mobile-back', 'aria-label': '返回', onclick: () => navBack({ view: 'workspaces' }) }, ['‹']),
        el('h1', { class: 'mobile-title mobile-titleInline' }, ['选择目录']),
        headerActions([
          globalSettingsButton(),
        ]),
      ]),
    ])
    if (state.sheet === 'settings') page.append(settingsSheet())
    if (state.sheet === 'power') page.append(powerSheet())
    if (state.sheet === 'pwa') page.append(pwaSheet())
    if (state.dirError) {
      page.append(el('div', { class: 'mobile-empty' }, [
        el('p', { class: 'mobile-error' }, [state.dirError]),
        el('button', { type: 'button', class: 'mobile-button', onclick: () => { state.dirError = ''; render(); void openDir(dir?.path) } }, ['重试']),
      ]))
      return page
    }
    if (!dir) {
      page.append(el('div', { class: 'mobile-empty' }, [el('p', { class: 'mobile-muted' }, ['加载中…'])]))
      return page
    }
    const crumbs = el('div', { class: 'dir-crumbs' })
    for (let idx = 0; idx < (dir.crumbs || []).length; idx += 1) {
      const crumb = dir.crumbs[idx]
      crumbs.append(el('button', { type: 'button', class: 'dir-crumb', onclick: () => void openDir(crumb.path) }, [crumb.name || '/']))
      if (idx < dir.crumbs.length - 1) crumbs.append(el('span', { class: 'dir-crumb-separator' }, ['/']))
    }
    page.append(crumbs)
    const list = el('ul', { class: 'mobile-list' })
    if (!dir.entries || dir.entries.length === 0) {
      list.append(el('div', { class: 'mobile-empty dir-empty' }, [el('p', { class: 'mobile-muted' }, ['空目录'])]))
    } else {
      for (const entry of dir.entries) {
        list.append(el('li', {}, [
          el('button', { type: 'button', class: `mobile-row dir-entry${entry.hidden ? ' dir-entry-hidden' : ''}`, onclick: () => void openDir(entry.path) }, [
            el('span', { class: 'mobile-rowTitle' }, [entry.name]),
          ]),
        ]))
      }
    }
    page.append(list)
    page.append(el('div', { class: 'dir-select' }, [
      el('button', { type: 'button', class: 'mobile-button', onclick: async () => {
        try {
          const result = await call('workspace.create', { path: dir.path })
          await openWorkspace(result.workspace, { locationMode: 'replace' })
        } catch (err) {
          state.dirError = String(err.message || err)
          render()
        }
      } }, ['选择此目录']),
    ]))
    return page
  }

export function renderPair() {
    const hint = el('p', { class: 'mobile-muted mobile-pairHint', role: 'status' }, [
      state.dirError || '粘贴桌面端复制的配对链接以连接此设备。',
    ])
    if (state.dirError) hint.className = 'mobile-error mobile-pairHint'
    const input = el('input', {
      id: 'mobile-pair-link',
      class: 'mobile-pairInput',
      type: 'text',
      inputmode: 'url',
      enterkeyhint: 'go',
      placeholder: 'https://your-host/mp/?pair=…',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
    })
    const pasteInto = async () => {
      let text = ''
      try { text = String(await navigator.clipboard.readText() || '').trim() } catch { /* iOS may deny */ }
      if (text) {
        input.value = text
        hint.className = 'mobile-muted mobile-pairHint'
        hint.textContent = '已粘贴，点配对继续。'
        return
      }
      input.focus()
      hint.className = 'mobile-muted mobile-pairHint'
      hint.textContent = '请长按输入框，选择粘贴。'
    }
    const form = el('form', { class: 'mobile-pairCard', novalidate: true }, [
      el('img', { class: 'pair-logo', src: '/mp/logo.svg', alt: '' }),
      el('h1', { class: 'mobile-title', id: 'mobile-pair-title' }, ['设备配对']),
      hint,
      el('div', { class: 'mobile-pairToolbar' }, [
        el('label', { class: 'mobile-pairLabel', for: 'mobile-pair-link' }, ['配对链接']),
        el('button', { type: 'button', class: 'mobile-pairPaste', onclick: () => { void pasteInto() } }, ['粘贴']),
      ]),
      input,
      el('button', { type: 'submit', class: 'mobile-new mobile-pairSubmit', disabled: state.creating }, ['配对']),
    ])
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault()
      const token = parsePairInput(input.value)
      if (!token) {
        state.dirError = '请输入有效的配对链接。'
        render()
        return
      }
      state.creating = true
      render()
      const message = await acceptPair(token)
      state.creating = false
      if (message) {
        state.dirError = message
        render()
        return
      }
      reloadPaired()
    })
    return el('main', { class: 'mobile mobile-pair' }, [form])
  }
