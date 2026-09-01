/**
 * Slash command and skill quick menu.
 */
import { state, chat } from '../state/state.js'
import { el } from '../utils/dom.js'
import { call } from '../net/rpc.js'
import { syncComposerDraft, focusComposer } from './composer.js'
import { render } from '../ui/views/render.js'

export async function loadSlashCatalog(sessionId) {
    const sid = sessionId || state.session?.sessionId
    if (!sid) return
    try {
      const [cmds, skills] = await Promise.all([
        call('command.list', { sessionId: sid }).catch(() => ({ items: [] })),
        call('skill.list', { sessionId: sid }).catch(() => ({ skills: [] })),
      ])
      chat.slashCommands = Array.isArray(cmds.items) ? cmds.items : []
      console.log("SKILLS RESP:", skills); chat.slashSkills = Array.isArray(skills.skills) ? skills.skills : (Array.isArray(skills.items) ? skills.items : [])
      if (state.view === 'chat' && state.draft.startsWith('/')) render()
    } catch {
      chat.slashCommands = []
      chat.slashSkills = []
    }
  }

export function parseSlashLine(line) {
    const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)
    if (!match) return null
    return { name: match[1], rest: line.slice(match[0].length) }
  }

export function slashQuery() {
    if (!state.draft.startsWith('/')) return ''
    const parsed = parseSlashLine(state.draft)
    if (parsed && /\s/.test(state.draft)) return parsed.name
    return state.draft.slice(1).toLowerCase()
  }

export function slashMenuGroups() {
    if (!state.draft.startsWith('/')) return { commands: [], skills: [] }
    const q = slashQuery()
    const cmdNames = new Set(chat.slashCommands.map((row) => row.name))
    return {
      commands: chat.slashCommands.filter((row) => !q || row.name.startsWith(q)),
      skills: chat.slashSkills.filter((row) => (!q || row.name.startsWith(q)) && !cmdNames.has(row.name)),
    }
  }

export function pickSlashItem(kind, name) {
    if (kind === 'command') {
      const row = chat.slashCommands.find((item) => item.name === name)
      if (row && row.hint) {
        setDraft(`/${name} `)
        render()
        return
      }
      setDraft(`/${name}`)
      void send()
      return
    }
    setDraft(`/${name} `)
    render()
  }

export function renderSlashMenu() {
    const groups = slashMenuGroups()
    if (groups.commands.length === 0 && groups.skills.length === 0) return null
    const row = (kind, item) => el('button', {
      type: 'button',
      class: 'slash-item',
      onclick: () => { pickSlashItem(kind, item.name) },
    }, [
      el('span', { class: 'slash-item-name' }, [`/${item.name}`]),
      el('span', { class: 'slash-item-desc' }, [item.description || (kind === 'skill' ? '技能' : '命令')]),
    ])
    const kids = []
    if (groups.commands.length) {
      kids.push(el('div', { class: 'slash-group' }, ['命令']))
      for (const item of groups.commands) kids.push(row('command', item))
    }
    if (groups.skills.length) {
      kids.push(el('div', { class: 'slash-group' }, ['技能']))
      for (const item of groups.skills) kids.push(row('skill', item))
    }
    return el('div', { class: 'slash-menu', role: 'listbox', 'aria-label': '斜杠命令' }, kids)
  }
