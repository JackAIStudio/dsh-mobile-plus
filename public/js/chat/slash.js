/**
 * Slash command and skill quick menu with ranking and keyword matching.
 */
import { state, chat } from '../state/state.js'
import { el } from '../utils/dom.js'
import { call } from '../net/rpc.js'
import { focusComposer, setDraft } from './composer.js'
import { send } from './outbox.js'
import { render } from '../ui/views/render.js'

let catalogLoading = false

export function isSlashActive() {
  const d = state.draft || ''
  return d.startsWith('/') && !/\s/.test(d) && !d.includes('\n')
}

export function slashQuery() {
  if (!isSlashActive()) return ''
  return (state.draft || '').slice(1).trim().toLowerCase()
}

export async function loadSlashCatalog(sessionId, cwd) {
  const sid = sessionId || state.session?.sessionId
  const targetCwd = cwd || state.workspace?.path || state.session?.cwd || ''
  if (catalogLoading) return
  catalogLoading = true
  try {
    const [cmds, skills] = await Promise.all([
      sid ? call('command.list', { sessionId: sid }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      call('skill.list', { sessionId: sid, cwd: targetCwd }).catch(() => ({ items: [] })),
    ])
    chat.slashCommands = Array.isArray(cmds?.items) ? cmds.items : []
    const rawSkills = Array.isArray(skills?.skills) ? skills.skills : (Array.isArray(skills?.items) ? skills.items : [])
    chat.slashSkills = rawSkills
    if (state.view === 'chat' && isSlashActive()) render()
  } catch {
    /* preserve last known items on transient error */
  } finally {
    catalogLoading = false
  }
}

export function parseSlashLine(line) {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)
  if (!match) return null
  return { name: match[1], rest: line.slice(match[0].length) }
}

function scoreCandidate(item, q) {
  if (!q) return 1
  const name = String(item.name || '').toLowerCase()
  const desc = String(item.description || '').toLowerCase()
  const when = String(item.whenToUse || '').toLowerCase()
  if (name === q) return 100
  if (name.startsWith(q)) return 80
  if (name.includes(`-${q}`) || name.includes(`_${q}`)) return 60
  if (name.includes(q)) return 40
  if (desc.includes(q) || when.includes(q)) return 20
  return 0
}

function rankList(list, q) {
  return list
    .map((item) => ({ item, score: scoreCandidate(item, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .map((entry) => entry.item)
}

export function slashMenuGroups() {
  if (!isSlashActive()) return { commands: [], skills: [] }
  const q = slashQuery()
  const cmdNames = new Set(chat.slashCommands.map((row) => row.name))
  const filteredSkills = chat.slashSkills.filter((row) => !cmdNames.has(row.name))
  return {
    skills: rankList(filteredSkills, q),
    commands: rankList(chat.slashCommands, q),
  }
}

export function pickSlashItem(kind, name) {
  if (kind === 'command') {
    const row = chat.slashCommands.find((item) => item.name === name)
    if (row && row.hint) {
      setDraft(`/${name} `)
      render()
      focusComposer()
      return
    }
    setDraft(`/${name}`)
    void send()
    return
  }
  setDraft(`/${name} `)
  render()
  focusComposer()
}

export function renderSlashMenu() {
  if (!isSlashActive()) return null
  if (chat.slashSkills.length === 0 && !catalogLoading) {
    void loadSlashCatalog()
  }
  const q = slashQuery()
  const groups = slashMenuGroups()
  const total = groups.commands.length + groups.skills.length

  const kids = []
  if (total === 0) {
    kids.push(el('div', { class: 'slash-empty' }, [
      el('span', { class: 'slash-empty-text' }, [q ? `未找到匹配 “/${q}” 的技能或命令` : '正在加载技能列表…']),
    ]))
  } else {
    const row = (kind, item) => el('button', {
      type: 'button',
      class: `slash-item slash-item-${kind}`,
      onclick: (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        pickSlashItem(kind, item.name)
      },
    }, [
      el('div', { class: 'slash-item-main' }, [
        el('span', { class: `slash-item-badge slash-badge-${kind}` }, [kind === 'skill' ? '✦ 技能' : '›_ 命令']),
        el('span', { class: 'slash-item-name' }, [`/${item.name}`]),
      ]),
      item.description ? el('span', { class: 'slash-item-desc' }, [item.description]) : null,
    ].filter(Boolean))

    if (groups.skills.length) {
      kids.push(el('div', { class: 'slash-group' }, [`技能 (${groups.skills.length})`]))
      for (const item of groups.skills) kids.push(row('skill', item))
    }
    if (groups.commands.length) {
      kids.push(el('div', { class: 'slash-group' }, [`命令 (${groups.commands.length})`]))
      for (const item of groups.commands) kids.push(row('command', item))
    }
  }

  return el('div', { class: 'slash-menu', role: 'listbox', 'aria-label': '斜杠命令与技能' }, kids)
}
