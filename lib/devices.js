import { randomBytes, randomInt } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { IDLE_MS } from './constants.js'

export function deviceCookie(id, row) {
  return typeof row?.secret === 'string' && row.secret !== '' ? row.secret : id
}

export function deviceId() {
  return randomBytes(16).toString('hex')
}

export function pairingCode() {
  return String(randomInt(100000, 1000000))
}

export function loadDevices(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && raw.devices && typeof raw.devices === 'object') return raw.devices
  } catch {}
  return {}
}

export function saveDevices(file, devices) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, devices }, null, 2), { mode: 0o600 })
}

export function aliveDevices(devices) {
  const now = Date.now()
  let count = 0
  let cleaned = false
  for (const id of Object.keys(devices)) {
    const row = devices[id]
    if (now - row.lastSeenAt > IDLE_MS) {
      delete devices[id]
      cleaned = true
      continue
    }
    count++
  }
  return { count, cleaned }
}
