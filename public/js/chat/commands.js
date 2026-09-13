/**
 * Slash command run and done event folding.
 */
import { isRecord, pickString, syntheticId, replaceMessage } from './fold.js'

export function applyCommandRun(state, event) {
  const data = isRecord(event.data) ? event.data : {}
  const cmdId = pickString(data.commandId)
  const name = pickString(data.name) || 'command'
  const args = typeof data.args === 'string' ? data.args : ''
  const id = cmdId ? `cmd-run:${cmdId}` : syntheticId('cmd-run', event.seq)
  const text = `/${name}${args}`.trimEnd()

  const existing = state.byId.get(id)
  if (existing !== undefined) {
    replaceMessage(state, existing, {
      ...existing,
      text,
      seq: event.seq,
      time: event.time,
    })
    return
  }
  const message = {
    id,
    kind: 'user',
    isCommand: true,
    commandId: cmdId,
    commandName: name,
    text,
    seq: event.seq,
    time: event.time,
  }
  state.messages.push(message)
  state.byId.set(id, message)
}

export function applyCommandDone(state, event) {
  const data = isRecord(event.data) ? event.data : {}
  const cmdId = pickString(data.commandId)
  const text = pickString(data.text)
  if (!text && data.kind === 'success') return
  const id = cmdId ? `cmd-done:${cmdId}` : syntheticId('cmd-done', event.seq)

  let commandName
  if (cmdId) {
    const runMsg = state.byId.get(`cmd-run:${cmdId}`)
    if (runMsg) commandName = runMsg.commandName
  }

  const existing = state.byId.get(id)
  if (existing !== undefined) {
    replaceMessage(state, existing, {
      ...existing,
      outcome: data.kind,
      text: text || '',
      seq: event.seq,
      time: event.time,
    })
    return
  }
  const message = {
    id,
    kind: 'command-result',
    commandId: cmdId,
    commandName,
    outcome: data.kind,
    text: text || (data.kind === 'error' ? '命令执行失败' : ''),
    seq: event.seq,
    time: event.time,
  }
  state.messages.push(message)
  state.byId.set(id, message)
}
