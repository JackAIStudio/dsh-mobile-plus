/**
 * Process tool/result events and associate outputs (images, paths, errors)
 * with the corresponding tool call in assistant messages.
 */
import { replaceMessage } from './fold.js'

export function applyToolResult(state, event) {
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  const message = data.message && typeof data.message === 'object' ? data.message : {}
  const source = message.source && typeof message.source === 'object' ? message.source : {}
  const callId = typeof source.callId === 'string' ? source.callId : ''

  if (!callId) return

  let target = undefined
  let toolIndex = -1
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const candidate = state.messages[i]
    if (candidate.kind === 'assistant' && Array.isArray(candidate.tools)) {
      const idx = candidate.tools.findIndex((t) => t.callId === callId)
      if (idx !== -1) {
        target = candidate
        toolIndex = idx
        break
      }
    }
  }

  if (!target || toolIndex === -1) return

  const content = Array.isArray(message.content) ? message.content : []
  let isError = false
  const attachments = []
  let filePath = undefined
  let errorText = ''
  let textOutput = ''

  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (part.isError === true) isError = true

    const innerContent = Array.isArray(part.content) ? part.content : [part]
    for (const item of innerContent) {
      if (!item || typeof item !== 'object') continue
      if (item.type === 'image' && item.attachment && item.attachment.attachmentId) {
        attachments.push(item.attachment)
      } else if (item.type === 'text' && typeof item.text === 'string') {
        textOutput += (textOutput ? '\n' : '') + item.text
        if (item.text.startsWith('Error:')) {
          isError = true
          errorText = item.text
        }
        const pathMatch = item.text.match(/<path>([\s\S]*?)<\/path>/)
        if (pathMatch && pathMatch[1]) filePath = pathMatch[1].trim()
      }
    }
  }

  const currentTool = target.tools[toolIndex]
  if (!filePath && currentTool.arguments) {
    try {
      const parsedArgs = JSON.parse(currentTool.arguments)
      if (typeof parsedArgs.path === 'string' && parsedArgs.path) {
        filePath = parsedArgs.path.trim()
      }
    } catch {}
  }

  const updatedTool = {
    ...currentTool,
    status: isError ? 'error' : 'ok',
    ...(attachments.length ? { attachments } : {}),
    ...(filePath ? { filePath } : {}),
    ...(errorText ? { errorText } : {}),
    ...(textOutput ? { textOutput } : {}),
  }

  const nextTools = target.tools.map((t, idx) => (idx === toolIndex ? updatedTool : t))
  const nextMessage = {
    ...target,
    tools: nextTools,
    seq: event.seq,
    time: event.time,
  }

  replaceMessage(state, target, nextMessage)
}
