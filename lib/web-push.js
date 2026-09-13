import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import crypto from 'node:crypto'
import { svc } from './utils.js'

const VAPID_FILE = join(homedir(), '.dsh', 'dsh-mobile-plus-vapid.json')
const SUBS_FILE = join(homedir(), '.dsh', 'dsh-mobile-plus-subscriptions.json')

let cachedKeys = null

export function getOrInitVapidKeys() {
  if (cachedKeys) return cachedKeys
  if (existsSync(VAPID_FILE)) {
    try {
      const data = JSON.parse(readFileSync(VAPID_FILE, 'utf8'))
      if (data && data.rawPublicKey && data.privateKeyPem) {
        cachedKeys = data
        return cachedKeys
      }
    } catch {}
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const rawPublicKey = publicKey.subarray(-65).toString('base64url')
  const keys = { rawPublicKey, privateKeyPem: privateKey }
  try {
    writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), 'utf8')
  } catch {}
  cachedKeys = keys
  return keys
}

export function getVapidPublicKey() {
  const keys = getOrInitVapidKeys()
  return keys.rawPublicKey
}

export function getSubscriptions() {
  if (!existsSync(SUBS_FILE)) return []
  try {
    const list = JSON.parse(readFileSync(SUBS_FILE, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function addSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) return false
  const subs = getSubscriptions().filter((s) => s.endpoint !== sub.endpoint)
  subs.push({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    updatedAt: Date.now(),
  })
  try {
    writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

export function removeSubscription(endpoint) {
  if (typeof endpoint !== 'string') return false
  const subs = getSubscriptions().filter((s) => s.endpoint !== endpoint)
  try {
    writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

function createVapidJwt(endpoint, subject, privKeyPem) {
  const origin = new URL(endpoint).origin
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: subject || 'mailto:admin@followjack.cn',
  })).toString('base64url')
  const unsigned = `${header}.${payload}`
  const sig = crypto.sign('SHA256', Buffer.from(unsigned), { key: privKeyPem, dsaEncoding: 'ieee-p1363' })
  return `${unsigned}.${sig.toString('base64url')}`
}

function encryptPayload(clientPubB64, clientAuthB64, text) {
  const clientPub = Buffer.from(clientPubB64, 'base64url')
  const clientAuth = Buffer.from(clientAuthB64, 'base64url')
  const localEcdh = crypto.createECDH('prime256v1')
  localEcdh.generateKeys()
  const localPub = localEcdh.getPublicKey()
  const shared = localEcdh.computeSecret(clientPub)
  const salt = crypto.randomBytes(16)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), clientPub, localPub])
  const ikm = crypto.hkdfSync('sha256', shared, clientAuth, keyInfo, 32)
  const cek = crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16)
  const nonce = crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12)

  const plaintext = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([2])])
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])

  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096, 0)
  const header = Buffer.concat([salt, rs, Buffer.from([localPub.length]), localPub])
  return Buffer.concat([header, ciphertext])
}

export async function sendPushNotification(sub, payloadObj) {
  const keys = getOrInitVapidKeys()
  const text = JSON.stringify(payloadObj || {})
  const endpoint = sub.endpoint
  try {
    const jwt = createVapidJwt(endpoint, 'mailto:admin@followjack.cn', keys.privateKeyPem)
    const bodyBuffer = encryptPayload(sub.keys.p256dh, sub.keys.auth, text)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${keys.rawPublicKey}`,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: '86400',
        Urgency: 'high',
      },
      body: bodyBuffer,
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404 || res.status === 410) {
      removeSubscription(endpoint)
      return { ok: false, gone: true }
    }
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: String(err.message || err) }
  }
}

export async function broadcastPushNotification(payloadObj) {
  const subs = getSubscriptions()
  if (subs.length === 0) return []
  return Promise.all(subs.map((s) => sendPushNotification(s, payloadObj)))
}

export function setupPersistenceHook(ctx) {
  ctx.effect(() => {
    const persistence = svc(ctx, 'sessionPersistence')
    if (!persistence || typeof persistence.append !== 'function') return
    const origAppend = persistence.append.bind(persistence)
    persistence.append = async function (id, events) {
      const res = await origAppend(id, events)
      try {
        const evList = Array.isArray(events) ? events : [events]
        if (evList.some((e) => e && (e.type === 'turn/end' || e.event?.type === 'turn/end'))) {
          let title = '会话'
          const sessionCtrl = svc(ctx, 'sessionController')
          const snap = sessionCtrl?.sessions?.snapshot?.()
          const row = snap?.byId?.[id]
          if (row?.title) title = row.title
          void broadcastPushNotification({
            title: '任务完成',
            body: `${title} 已完成`,
            sessionId: id,
          })
        }
      } catch {}
      return res
    }
    return () => { persistence.append = origAppend }
  }, 'dsh-mobile-plus: web push persistence hook')
}
