import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, posix, resolve, win32 } from 'node:path'
import { DIR_MAX_ENTRIES } from './constants.js'

export function fullyQualifiedPath(path, platform = process.platform) {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

export function ancestryCrumbs(target) {
  const crumbs = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    crumbs.unshift({
      name: parent === current ? current : basename(current),
      path: current,
      hidden: false,
    })
    if (parent === current) return crumbs
    current = parent
  }
}

export function failDirectory(code, path, message) {
  return { result: { ok: false, error: { code, message, details: { path } } } }
}

export async function listHostDirectory(payload, signal) {
  const home = homedir()
  const requested = payload && typeof payload.path === 'string' ? payload.path : undefined
  if (requested !== undefined && !fullyQualifiedPath(requested)) {
    return failDirectory('directory-unreadable', requested, `cannot list "${requested}": not a fully qualified path`)
  }
  const target = resolve(requested ?? home)
  try {
    signal?.throwIfAborted()
    const dirents = await readdir(target, { withFileTypes: true })
    signal?.throwIfAborted()
    const candidates = dirents
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name))
    const entries = []
    let truncated = false
    for (const dirent of candidates) {
      signal?.throwIfAborted()
      if (entries.length >= DIR_MAX_ENTRIES) {
        truncated = true
        break
      }
      const child = join(target, dirent.name)
      let enterable = dirent.isDirectory()
      if (!enterable && dirent.isSymbolicLink()) {
        try {
          enterable = (await stat(child)).isDirectory()
        } catch {
          if (signal?.aborted) {
            const reason = signal.reason
            throw reason instanceof Error ? reason : new Error(String(reason))
          }
          continue
        }
      }
      if (!enterable) continue
      entries.push({ name: dirent.name, path: child, hidden: dirent.name.startsWith('.') })
    }
    return {
      result: {
        ok: true,
        value: {
          path: target,
          home,
          crumbs: ancestryCrumbs(target),
          entries,
          truncated,
        },
      },
    }
  } catch (error) {
    if (signal?.aborted) {
      return { result: { ok: false, error: { code: 'cancelled', message: 'directory listing was aborted', details: {} } } }
    }
    const message = error instanceof Error ? error.message : String(error)
    return failDirectory('directory-unreadable', target, `cannot list ${target}: ${message}`)
  }
}
