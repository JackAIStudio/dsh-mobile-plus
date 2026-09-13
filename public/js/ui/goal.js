/**
 * GoalDock standing goal strip and inline management view.
 */
import { chat, runtime } from '../state/state.js'
import { el } from '../utils/dom.js'
import { pauseCurrentGoal, resumeCurrentGoal, editCurrentGoal, clearCurrentGoal } from '../chat/goal.js'
import { render } from './views/render.js'

let goalEditing = false
let goalDraft = ''
let goalExpanded = false

export function targetIcon() {
  return el('span', {
    class: 'goal-dock-lead',
    html: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg>',
  })
}

export function pauseIcon() {
  return el('span', {
    class: 'goal-btn-icon',
    html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="4" y="3" width="2.8" height="10" rx="1.2" fill="currentColor"/><rect x="9.2" y="3" width="2.8" height="10" rx="1.2" fill="currentColor"/></svg>',
  })
}

export function playIcon() {
  return el('span', {
    class: 'goal-btn-icon',
    html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.8 3.4a.8.8 0 0 1 1.2-.7l7 4.6a.8.8 0 0 1 0 1.4l-7 4.6a.8.8 0 0 1-1.2-.7V3.4z" fill="currentColor"/></svg>',
  })
}

export function editIcon() {
  return el('span', {
    class: 'goal-btn-icon',
    html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.6 2.4a1.4 1.4 0 0 1 2 2L5.2 12.8l-3.2.8.8-3.2 8.8-8z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  })
}

export function trashIcon() {
  return el('span', {
    class: 'goal-btn-icon',
    html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M12.5 4.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  })
}

export function checkIcon() {
  return el('span', {
    class: 'goal-btn-icon',
    html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  })
}

export function closeIcon() {
  return el('span', {
    class: 'goal-btn-icon',
    html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  })
}

const PHASE_NAMES = {
  active: '进行中的目标',
  paused: '已暂停的目标',
  blocked: '受阻的目标',
}

export function renderGoalDock(goal) {
  if (!goal || goal.phase === 'complete') {
    goalEditing = false
    return null
  }

  const phase = goal.phase || 'active'
  const isBlocked = phase === 'blocked'
  const isPaused = phase === 'paused'
  const blockedMessage = goal.blockedReason?.message

  if (goalEditing) {
    return el('section', { class: 'goal-dock is-editing', 'aria-label': '编辑目标' }, [
      el('div', { class: 'goal-dock-body' }, [
        el('div', { class: 'goal-dock-row' }, [
          targetIcon(),
          el('input', {
            type: 'text',
            class: 'goal-dock-input',
            value: goalDraft,
            placeholder: '输入目标内容…',
            oninput: (e) => { goalDraft = e.target.value },
            onkeydown: async (e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const trimmed = goalDraft.trim()
                if (trimmed && (await editCurrentGoal(trimmed))) {
                  goalEditing = false
                  render()
                }
              } else if (e.key === 'Escape') {
                goalEditing = false
                render()
              }
            },
          }),
          el('div', { class: 'goal-dock-actions' }, [
            el('button', {
              type: 'button',
              class: 'goal-icon-btn goal-btn-save',
              'aria-label': '保存目标',
              onclick: async (e) => {
                e.stopPropagation()
                const trimmed = goalDraft.trim()
                if (trimmed && (await editCurrentGoal(trimmed))) {
                  goalEditing = false
                  render()
                }
              },
            }, [checkIcon()]),
            el('button', {
              type: 'button',
              class: 'goal-icon-btn goal-btn-cancel',
              'aria-label': '取消编辑',
              onclick: (e) => {
                e.stopPropagation()
                goalEditing = false
                render()
              },
            }, [closeIcon()]),
          ]),
        ]),
      ]),
    ])
  }

  const roundBadge = goal.roundsStarted > 0
    ? el('span', { class: 'goal-round-badge' }, [`第 ${goal.roundsStarted}${goal.maxGoalRounds ? `/${goal.maxGoalRounds}` : ''} 轮`])
    : null

  const actions = el('div', { class: 'goal-dock-actions' }, [
    phase === 'active'
      ? el('button', {
          type: 'button',
          class: 'goal-icon-btn',
          'aria-label': '暂停目标',
          onclick: (e) => {
            e.stopPropagation()
            void pauseCurrentGoal()
          },
        }, [pauseIcon()])
      : null,
    isPaused
      ? el('button', {
          type: 'button',
          class: 'goal-icon-btn',
          'aria-label': '恢复目标',
          onclick: (e) => {
            e.stopPropagation()
            void resumeCurrentGoal()
          },
        }, [playIcon()])
      : null,
    el('button', {
      type: 'button',
      class: 'goal-icon-btn',
      'aria-label': '编辑目标',
      onclick: (e) => {
        e.stopPropagation()
        goalDraft = goal.objective
        goalEditing = true
        render()
      },
    }, [editIcon()]),
    el('button', {
      type: 'button',
      class: 'goal-icon-btn goal-btn-clear',
      'aria-label': '清除目标',
      onclick: (e) => {
        e.stopPropagation()
        if (confirm('确定要清除当前目标吗？')) {
          void clearCurrentGoal()
        }
      },
    }, [trashIcon()]),
  ].filter(Boolean))

  const cls = ['goal-dock', `is-${phase}`]
  if (goalExpanded) cls.push('is-expanded')

  return el('section', {
    class: cls.join(' '),
    'aria-label': '目标规划',
  }, [
    el('div', { class: 'goal-dock-body' }, [
      el('div', {
        class: 'goal-dock-row',
        onclick: () => {
          goalExpanded = !goalExpanded
          render()
        },
      }, [
        targetIcon(),
        el('span', { class: 'goal-dock-title' }, [PHASE_NAMES[phase] || '目标']),
        roundBadge,
        el('span', { class: 'goal-dock-objective' }, [goal.objective]),
        actions,
      ]),
      goalExpanded ? el('div', { class: 'goal-dock-detail' }, [
        el('div', { class: 'goal-detail-text' }, [goal.objective]),
        isBlocked && blockedMessage
          ? el('div', { class: 'goal-blocked-reason' }, [`受阻原因：${blockedMessage}`])
          : null,
      ]) : null,
    ]),
  ])
}
