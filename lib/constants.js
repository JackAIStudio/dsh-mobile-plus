import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PREFIX = '/mp'
export const COOKIE = 'mp_device'
export const TOKEN_TTL_MS = 2 * 60 * 60 * 1000
export const IDLE_MS = 7 * 24 * 60 * 60 * 1000
export const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365
export const OFFLINE_MS = 90 * 1000
export const MAX_BODY = 12 * 1024 * 1024
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const DIR_MAX_ENTRIES = 1000
export const SESSION_PAGE = 20
export const QUOTA_TTL_MS = 8000

export const ALLOW = new Set([
  'workspace.list',
  'workspace.create',
  'host.listDirectory',
  'agentPreset.list',
  'session.list',
  'session.create',
  'session.history',
  'session.prompt',
  'session.cancel',
  'session.attachment',
  'session.models',
  'session.selectModel',
  'skill.list',
  'command.list',
  'command.execute',
  'mobile.pending',
  'mobile.respond',
  'quota.read',
  'host.restart',
])

export const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

export const ROOT = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = join(ROOT, '..')
export const PUBLIC = join(PLUGIN_ROOT, 'public')

export function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}
