/**
 * Theme toggle and header navigation action buttons.
 */
import { state, chat, runtime } from '../state/state.js'
import { el } from '../utils/dom.js'
import { contextUsage } from '../chat/composer.js'
import { reloadPaired } from '../state/route.js'
import { render } from './views/render.js'
import { openToday } from './views/ws-view.js'
import { openQuotaSheet } from '../net/quota.js'

const THEME_KEY = 'dsh.mobile.theme'

export function storedTheme() {
    try { return localStorage.getItem(THEME_KEY) } catch { return null }
  }

export function isDarkTheme() {
    const saved = storedTheme()
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  }

export function applyTheme() {
    const dark = isDarkTheme()
    document.documentElement.dataset.theme = dark ? 'dark' : ''
    
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove())
    let meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = dark ? '#111418' : '#f3f5f9'
    document.head.appendChild(meta)
  }

export function toggleTheme() {
    const next = isDarkTheme() ? 'light' : 'dark'
    try { localStorage.setItem(THEME_KEY, next) } catch { /* ignore */ }
    applyTheme()
    render()
  }

export function headerIcon(markup) {
    // innerHTML so the browser parses real SVG namespace nodes.
    // createElement('svg') stays in the HTML namespace and paints nothing.
    return el('span', { class: 'mobile-header-icon', 'aria-hidden': 'true', html: markup })
  }

export function themeToggle() {
    const dark = isDarkTheme()
    return el('button', {
      type: 'button', class: 'mobile-theme-toggle',
      'aria-label': dark ? '切换到浅色' : '切换到深色',
      onclick: toggleTheme,
    }, [
      headerIcon(dark
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>'),
    ])
  }

export function reloadApp() {
    window.location.reload()
  }

export function reloadButton() {
    return el('button', {
      type: 'button',
      class: 'mobile-theme-toggle mobile-reload-btn',
      'aria-label': '系统操作',
      title: '系统操作',
      onclick: () => {
        state.sheet = 'power'
        render()
      },
    }, [
      headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>'),
    ])
  }

export function headerActions(nodes) {
    return el('div', { class: 'mobile-header-actions' }, nodes.filter(Boolean))
  }

export function todayButton() {
    const busy = state.creating
    return el('button', {
      type: 'button',
      class: 'mobile-theme-toggle mobile-today-btn',
      disabled: busy,
      'aria-label': busy ? '正在打开今天的工作区' : '打开今天的工作区',
      title: '打开今天的工作区',
      onclick: () => { void openToday() },
    }, [
      headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/><rect x="10" y="13" width="4" height="4" rx="0.8" fill="currentColor" stroke="none"/></svg>'),
    ])
  }

export function pwaButton() {
    const open = state.sheet === 'pwa'
    return el('button', {
      type: 'button',
      class: 'mobile-theme-toggle mobile-pwa-btn',
      'aria-label': '如何添加到主屏幕',
      'aria-haspopup': 'dialog',
      'aria-expanded': open ? 'true' : 'false',
      title: '添加到主屏幕',
      onclick: () => {
        state.sheet = state.sheet === 'pwa' ? null : 'pwa'
        render()
      },
    }, [
      headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>'),
    ])
  }

export function globalSettingsButton() {
    const inChat = state.view === 'chat'
    const pct = inChat ? contextUsage() : undefined
    const warn = pct !== undefined && pct >= 80
    const open = state.sheet === 'settings' || state.sheet === 'model'
    return el('button', {
      type: 'button',
      class: 'mobile-settings-btn',
      'aria-label': warn ? `设置，上下文已用 ${pct}%` : '设置与控制',
      'aria-haspopup': 'dialog',
      'aria-expanded': open ? 'true' : 'false',
      onclick: () => {
        state.sheetReturn = null
        state.sheet = state.sheet === 'settings' ? null : 'settings'
        render()
      },
    }, [
      headerIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>'),
      inChat ? el('span', { class: 'mobile-settings-label' }, ['设置']) : null,
      warn ? el('span', { class: 'mobile-settings-dot', 'aria-hidden': 'true' }) : null,
    ])
  }
