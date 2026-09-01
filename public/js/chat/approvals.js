/**
 * Permission approval and interactive question panels.
 */
import { state, chat } from '../state/state.js'
import { el } from '../utils/dom.js'
import { call } from '../net/rpc.js'
import { render } from '../ui/views/render.js'

export function renderApprovalPanel(approval) {
    return el('div', { class: 'chat-approval-panel', role: 'alert' }, [
      el('div', { class: 'chat-approval-header' }, [
        el('span', { class: 'chat-tool-pill' }, [approval.toolName]),
        approval.reason ? el('span', { class: 'chat-approval-reason' }, [approval.reason]) : null,
      ]),
      approval.error ? el('p', { class: 'chat-approval-error' }, [approval.error]) : null,
      el('div', { class: 'chat-approval-actions' }, [
        el('button', {
          type: 'button',
          class: 'chat-approval-allow',
          disabled: approval.busy === true,
          onclick: () => { void respondApproval(approval, 'allowed-once') },
        }, [approval.busy ? '提交中…' : '允许一次']),
        el('button', {
          type: 'button',
          class: 'chat-approval-reject',
          disabled: approval.busy === true,
          onclick: () => { void respondApproval(approval, 'rejected') },
        }, ['拒绝']),
      ]),
    ])
  }

export async function respondApproval(approval, outcome) {
    if (approval.busy || !state.session) return
    approval.busy = true
    approval.error = undefined
    render()
    try {
      await call('mobile.respond', {
        sessionId: state.session.sessionId,
        type: 'approval',
        approvalId: approval.approvalId,
        rpcId: approval.rpcId,
        outcome,
      })
      chat.approvals = chat.approvals.filter((row) => row.approvalId !== approval.approvalId)
    } catch (err) {
      approval.busy = false
      approval.error = String(err.message || err)
    }
    render()
  }

export function answerOf(group, questionId) {
    if (!group.answers[questionId]) group.answers[questionId] = { selected: [], custom: '' }
    return group.answers[questionId]
  }

export function renderQuestionPanel(group) {
    return el('div', { class: 'chat-question-panel', role: 'form' }, [
      ...group.questions.map((q) => {
        const answer = answerOf(group, q.id)
        const multi = q.multiSelect === true
        return el('div', { class: 'chat-question-group' }, [
          q.header ? el('div', { class: 'chat-question-header' }, [q.header]) : null,
          el('div', { class: 'chat-question-text' }, [q.question]),
          q.detail ? el('div', { class: 'chat-question-detail' }, [q.detail]) : null,
          Array.isArray(q.options) && q.options.length
            ? el('div', { class: 'chat-question-options' }, q.options.map((option) => {
                const label = option.label
                const selected = answer.selected.includes(label)
                return el('label', { class: `chat-question-option${selected ? ' chat-question-option-selected' : ''}` }, [
                  el('input', {
                    type: multi ? 'checkbox' : 'radio',
                    name: `q-${group.rpcId}-${q.id}`,
                    checked: selected,
                    onchange: () => {
                      if (multi) {
                        const set = new Set(answer.selected)
                        if (set.has(label)) set.delete(label)
                        else set.add(label)
                        answer.selected = [...set]
                      } else {
                        answer.selected = [label]
                      }
                      render()
                    },
                  }),
                  el('span', { class: 'chat-question-option-label' }, [label]),
                  option.description ? el('span', { class: 'chat-question-option-desc' }, [option.description]) : null,
                ])
              }))
            : null,
          el('textarea', {
            class: 'chat-question-custom',
            placeholder: '自定义回答（可选）',
            rows: 2,
            value: answer.custom,
            oninput: (ev) => { answer.custom = ev.target.value },
          }),
        ])
      }),
      group.error ? el('p', { class: 'chat-approval-error' }, [group.error]) : null,
      el('button', {
        type: 'button',
        class: 'chat-question-submit',
        disabled: group.busy === true,
        onclick: () => { void respondQuestion(group) },
      }, [group.busy ? '提交中…' : '提交回答']),
    ])
  }

export async function respondQuestion(group) {
    if (group.busy || !state.session) return
    group.busy = true
    group.error = undefined
    render()
    const answers = group.questions.map((q) => {
      const answer = answerOf(group, q.id)
      return {
        id: q.id,
        selected: answer.selected,
        ...(answer.custom ? { custom: answer.custom } : {}),
      }
    })
    try {
      await call('mobile.respond', {
        sessionId: state.session.sessionId,
        type: 'question',
        rpcId: group.rpcId,
        answers,
      })
      chat.questions = chat.questions.filter((row) => row.rpcId !== group.rpcId)
    } catch (err) {
      group.busy = false
      group.error = String(err.message || err)
    }
    render()
  }
