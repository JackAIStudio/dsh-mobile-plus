/**
 * Specialized card renderer for image tools (Grok Imagine, read_image screenshots, etc.).
 * Provides semantic categorization, responsive placeholder, thumbnail loading,
 * and progressive lightbox preview.
 */
import { el, basename } from '../utils/dom.js'
import { openImageLightbox } from '../ui/lightbox.js'
import { loadAttachmentUrl, peekAttachmentUrl } from './attachment-loader.js'

function formatBytes(bytes) {
  if (!bytes || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function parseToolMeta(tool) {
  let prompt = ''
  let filePath = tool.filePath || ''
  if (tool.arguments) {
    try {
      const parsed = JSON.parse(tool.arguments)
      if (typeof parsed.prompt === 'string') prompt = parsed.prompt.trim()
      if (!filePath && typeof parsed.path === 'string') filePath = parsed.path.trim()
      if (!filePath && typeof parsed.file_path === 'string') filePath = parsed.file_path.trim()
    } catch {}
  }
  return { prompt, filePath }
}

export function categorizeImageTool(tool) {
  const name = (tool?.name || '').toLowerCase()
  const { prompt, filePath } = parseToolMeta(tool)
  const fileLower = filePath.toLowerCase()
  const isScreen = fileLower.includes('screen') || fileLower.includes('shot') || fileLower.includes('desktop')

  if (name === 'grok_image_gen') {
    return {
      title: 'Grok 生图',
      kind: 'gen',
      icon: 'image',
      runningBadge: '生成中…',
      runningText: '正在渲染画面，稍候即出…',
      failTitle: '生图失败',
      summary: prompt ? prompt.split('\n')[0] : (filePath ? basename(filePath) : ''),
      filePath,
    }
  }

  if (name.includes('imagine') || name.includes('image_gen') || name.includes('generate_image') || name.includes('draw')) {
    return {
      title: 'AI 生图',
      kind: 'gen',
      icon: 'image',
      runningBadge: '生成中…',
      runningText: '正在生成图片，稍候即出…',
      failTitle: '生图失败',
      summary: prompt ? prompt.split('\n')[0] : (filePath ? basename(filePath) : ''),
      filePath,
    }
  }

  if (name === 'browser_shot') {
    return {
      title: '网页截图',
      kind: 'shot',
      icon: 'screen',
      runningBadge: '截图中…',
      runningText: '正在截取网页画面…',
      failTitle: '截图失败',
      summary: filePath ? basename(filePath) : (prompt || ''),
      filePath,
    }
  }

  if (name === 'read_image') {
    return {
      title: isScreen ? '屏幕截图' : '图片查看',
      kind: isScreen ? 'shot' : 'view',
      icon: isScreen ? 'screen' : 'image',
      runningBadge: '读取中…',
      runningText: isScreen ? '正在截取并读取屏幕…' : '正在读取图片内容…',
      failTitle: isScreen ? '截图读取失败' : '读取失败',
      summary: filePath ? basename(filePath) : (prompt || ''),
      filePath,
    }
  }

  return {
    title: isScreen ? '屏幕截图' : '图片产物',
    kind: isScreen ? 'shot' : 'asset',
    icon: isScreen ? 'screen' : 'image',
    runningBadge: '处理中…',
    runningText: '正在加载图片…',
    failTitle: '处理失败',
    summary: filePath ? basename(filePath) : (prompt || ''),
    filePath,
  }
}

export function isImageTool(tool) {
  if (!tool || typeof tool !== 'object') return false
  if (tool.name === 'grok_image_gen' || tool.name === 'read_image' || tool.name === 'browser_shot') return true
  if (Array.isArray(tool.attachments) && tool.attachments.length > 0) return true
  return false
}

function renderIcon(iconType) {
  if (iconType === 'screen') {
    return el('svg', { width: '15', height: '15', viewBox: '0 0 16 16', fill: 'none' }, [
      el('rect', { x: '2', y: '2.5', width: '12', height: '8.5', rx: '1.5', stroke: 'currentColor', 'stroke-width': '1.3' }),
      el('path', { d: 'M6 14h4M8 11v3', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round' }),
    ])
  }
  return el('svg', { width: '15', height: '15', viewBox: '0 0 16 16', fill: 'none' }, [
    el('rect', { x: '2', y: '2', width: '12', height: '12', rx: '3', stroke: 'currentColor', 'stroke-width': '1.5' }),
    el('circle', { cx: '5.5', cy: '5.5', r: '1.25', fill: 'currentColor' }),
    el('path', { d: 'M3 12.5l3.5-3.5 3 3 2-2 2 2.5', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ])
}

export function renderToolImageCard(tool, sessionId = '') {
  const meta = categorizeImageTool(tool)
  const attachments = Array.isArray(tool.attachments) ? tool.attachments : []
  let status = attachments.length > 0
    ? 'ok'
    : (tool.status || (tool.errorText ? 'error' : 'running'))

  const head = el('div', { class: 'tool-image-head' }, [
    el('span', { class: 'tool-image-icon' }, [renderIcon(meta.icon)]),
    el('span', { class: 'tool-image-title' }, [meta.title]),
    status === 'running'
      ? el('span', { class: 'tool-image-badge is-running' }, [meta.runningBadge])
      : status === 'error'
        ? el('span', { class: 'tool-image-badge is-error' }, ['失败'])
        : el('span', { class: 'tool-image-badge is-ok' }, ['完成']),
    meta.summary ? el('span', { class: 'tool-image-summary', title: meta.summary }, [meta.summary]) : null,
  ])

  const bodyElements = []

  if (status === 'running') {
    bodyElements.push(
      el('div', { class: 'tool-image-skeleton', style: 'aspect-ratio: 16 / 9;' }, [
        el('div', { class: 'tool-image-shimmer' }),
        el('div', { class: 'tool-image-loading-text' }, [meta.runningText]),
      ])
    )
  } else if (status === 'error') {
    bodyElements.push(
      el('div', { class: 'tool-image-error-box' }, [
        el('span', { class: 'tool-image-error-title' }, [meta.failTitle]),
        el('div', { class: 'tool-image-error-desc' }, [tool.errorText || '连接异常或未能获取图像数据']),
      ])
    )
  } else if (attachments.length > 0) {
    const gallery = el('div', { class: 'tool-image-gallery' }, attachments.map((att) => {
      const w = att.width || 16
      const h = att.height || 9
      const ratio = `${w} / ${h}`
      const initialSrc = peekAttachmentUrl(att.attachmentId, 'thumb') || ''

      const metaParts = []
      if (att.width && att.height) metaParts.push(`${att.width}×${att.height}`)
      if (att.bytes) metaParts.push(formatBytes(att.bytes))

      const img = el('img', {
        alt: att.name || meta.title,
        class: 'tool-image-thumb-img',
        loading: 'lazy',
      })
      if (initialSrc) img.src = initialSrc

      const btn = el('button', {
        type: 'button',
        class: 'tool-image-thumb-btn',
        style: `aspect-ratio: ${ratio};`,
        'aria-label': '点按全屏查看原图',
        onclick: async () => {
          const currentThumb = img.src || await loadAttachmentUrl(sessionId, att.attachmentId, 'thumb')
          const currentFull = await loadAttachmentUrl(sessionId, att.attachmentId, 'raw')
          openImageLightbox(currentThumb, currentFull)
        },
      }, [
        img,
        metaParts.length
          ? el('span', { class: 'tool-image-meta-pill' }, [metaParts.join(' · ')])
          : null,
      ])

      if (!initialSrc) {
        btn.classList.add('is-loading')
        loadAttachmentUrl(sessionId, att.attachmentId, 'thumb').then((url) => {
          img.src = url
          btn.classList.remove('is-loading')
        })
      }

      return btn
    }))
    bodyElements.push(gallery)
  }

  const footElements = []
  if (meta.filePath) {
    footElements.push(
      el('div', { class: 'tool-image-foot' }, [
        el('span', { class: 'tool-image-path-icon' }, ['📁']),
        el('span', { class: 'tool-image-path-text', title: meta.filePath }, [basename(meta.filePath)]),
      ])
    )
  }

  return el('div', { class: `tool-image-card is-${status}` }, [
    head,
    ...bodyElements,
    ...footElements,
  ])
}
