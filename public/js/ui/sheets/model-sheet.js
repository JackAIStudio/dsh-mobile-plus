/**
 * Model and reasoning effort selection bottom sheet.
 */
import { state, chat } from '../../state/state.js'
import { el } from '../../utils/dom.js'
import { call } from '../../net/rpc.js'
import { closeSheet, switchSheet, syncSheetPortal } from './portal.js'

export function openModelSheet() {
  if (state.sheet === 'settings') state.sheetReturn = 'settings'
  state.sheet = 'model'
  chat.modelSheet = { status: 'loading' }
  chat.modelError = undefined
  syncSheetPortal()
  void call('session.models', { sessionId: state.session.sessionId }).then(
    (data) => {
      chat.modelSheet = { status: 'ready', data }
      if (state.sheet === 'model') syncSheetPortal(true)
    },
    (err) => {
      chat.modelSheet = { status: 'error', message: String(err.message || err) }
      if (state.sheet === 'model') syncSheetPortal(true)
    },
  )
}

export function renderModelSheet() {
  const backToSettings = () => {
    state.sheetReturn = null
    switchSheet('settings')
  }
  const dismiss = () => {
    state.sheetReturn = null
    closeSheet()
  }
  const close = state.sheetReturn === 'settings' ? backToSettings : dismiss
  const sheet = (kids) => el('div', { class: 'sheet-backdrop', onclick: close }, [
    el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '模型与思考强度', onclick: (ev) => { ev.stopPropagation() } }, [
      el('div', { class: 'sheet-handle' }),
      el('div', { class: 'sheet-title sheet-title-nav' }, [
        state.sheetReturn === 'settings'
          ? el('button', { type: 'button', class: 'sheet-back', 'aria-label': '返回设置', onclick: (ev) => { ev.stopPropagation(); backToSettings() } }, ['‹'])
          : null,
        '模型与思考强度',
      ]),
      el('div', { class: 'sheet-body' }, kids),
    ]),
  ])

  const ms = chat.modelSheet
  if (ms.status === 'loading') {
    return sheet([el('div', { class: 'sheet-status' }, ['正在加载模型目录…'])])
  }
  if (ms.status === 'error') {
    return sheet([
      el('div', { class: 'sheet-status sheet-status-error' }, [
        el('span', {}, [ms.message]),
        el('button', { type: 'button', class: 'chat-load-older', onclick: () => void openModelSheet() }, ['重试']),
      ]),
    ])
  }

  const { data } = ms
  const selected = chat.currentModel ?? data.current
  const choices = (data.groups || []).flatMap((group) => group.models.map((model) => ({ group, model })))
  const currentChoice = choices.find((c) => c.group.id === selected.provider && c.model.id === selected.model)
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = selected.reasoningEffort ?? reasoning?.defaultEffort
  const effortChoices = reasoning === undefined
    ? []
    : [
        ...(reasoning.defaultEffort === undefined
          ? [{ key: 'provider-default', effort: undefined, label: '跟随模型默认' }]
          : []),
        ...reasoning.efforts.map((effort) => ({
          key: `effort:${effort.id}`,
          effort: effort.id,
          label: effort.name,
          description: effort.description,
        })),
      ]

  const option = (isSelected, kids, onPick) => el('button', {
    type: 'button',
    class: `sheet-option${isSelected ? ' sheet-option-selected' : ''}`,
    disabled: chat.modelBusy,
    onclick: () => void onPick(),
  }, [
    el('span', { class: 'sheet-option-copy' }, kids),
    isSelected ? el('span', { class: 'sheet-option-check', 'aria-hidden': 'true' }, ['√']) : null,
  ])

  const apply = async (selection) => {
    if (chat.modelBusy) return
    chat.modelBusy = true
    chat.modelError = undefined
    syncSheetPortal(true)
    try {
      const result = await call('session.selectModel', {
        sessionId: state.session.sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
      })
      chat.modelBusy = false
      chat.currentModel = result.selected
      close()
    } catch (err) {
      chat.modelBusy = false
      chat.modelError = String(err.message || err)
      syncSheetPortal(true)
    }
  }

  const kids = []
  if (chat.modelError !== undefined) kids.push(el('p', { class: 'sheet-error' }, [chat.modelError]))
  for (const failure of data.failures || []) {
    kids.push(el('p', { class: 'sheet-error' }, [`${failure.name}: ${failure.message}`]))
  }
  if ((data.groups || []).length === 0 && choices.length === 0) {
    kids.push(el('div', { class: 'sheet-status' }, ['没有可用的模型']))
  }
  for (const group of data.groups || []) {
    const rows = group.models.map((model) => {
      const isSelected = selected.provider === group.id && selected.model === model.id
      return option(isSelected, [
        el('span', { class: 'sheet-option-title' }, [model.name]),
        model.description !== undefined ? el('span', { class: 'sheet-option-desc' }, [model.description]) : null,
      ], () => apply({
        provider: group.id,
        model: model.id,
        ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
      }))
    })
    kids.push(el('div', { class: 'sheet-section' }, [
      el('div', { class: 'sheet-section-title' }, [group.name]),
      ...rows,
    ]))
  }
  if (effortChoices.length > 0) {
    kids.push(el('div', { class: 'sheet-section' }, [
      el('div', { class: 'sheet-section-title' }, ['思考强度']),
      ...effortChoices.map((choice) => option(effectiveEffort === choice.effort, [
        el('span', { class: 'sheet-option-title' }, [choice.label]),
        choice.description !== undefined ? el('span', { class: 'sheet-option-desc' }, [choice.description]) : null,
      ], () => apply({
        provider: selected.provider,
        model: selected.model,
        ...(choice.effort !== undefined ? { reasoningEffort: choice.effort } : {}),
      }))),
    ]))
  }
  return sheet(kids)
}
