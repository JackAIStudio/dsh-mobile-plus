/**
 * DOM manipulation and SVG icon helpers.
 */
import { state, runtime } from '../state/state.js'

export const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null

export function el(tag, attrs, kids) {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k === 'class') node.className = v
      else if (k === 'html') node.innerHTML = v
      else if (v === true) node.setAttribute(k, '')
      else if (v !== false && v != null && k !== 'value') node.setAttribute(k, String(v))
    }
    if ((tag === 'textarea' || tag === 'input' || tag === 'select') && attrs && 'value' in attrs) node.value = attrs.value
    for (const kid of kids || []) {
      if (kid == null || kid === false) continue
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
    }
    return node
  }

export function basename(path) {
    if (!path) return ''
    const parts = String(path).replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] || path
  }

export function workspaceTitle(ws) {
    const title = typeof ws?.title === 'string' ? ws.title.trim() : ''
    if (title && !/[/\\]/.test(title)) return title
    return basename(ws?.path) || title || '工作区'
  }

export function isWindowsStylePath(value) {
    return /^[A-Za-z]:[/\\]/.test(value) || String(value).startsWith('\\\\')
  }

export function abbreviateHomePath(path) {
    if (!path) return ''
    const raw = String(path)
    if (isWindowsStylePath(raw)) return raw
    const inferred = (raw.match(/^(\/(?:Users|home)\/[^/]+)/) || [])[1] || ''
    const home = String(state.home || inferred).replace(/\/+$/, '')
    if (!home || home === '/' || isWindowsStylePath(home)) return raw
    const trimmed = raw.replace(/\/+$/, '')
    if (trimmed === home) return '~'
    if (raw.startsWith(`${home}/`)) return `~${raw.slice(home.length)}`
    return raw
  }
