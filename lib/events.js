import { json } from './utils.js'

export function muxEnvelope(frame) {
  if (!frame || typeof frame !== 'object') return null
  if (frame.type === 'server-request' && frame.payload && typeof frame.payload === 'object') {
    return { rpcId: typeof frame.rpcId === 'string' ? frame.rpcId : '', payload: frame.payload }
  }
  if (typeof frame.rpcId === 'string' && frame.payload && typeof frame.payload === 'object' && typeof frame.payload.type === 'string') {
    return { rpcId: frame.rpcId, payload: frame.payload }
  }
  if (typeof frame.type === 'string') {
    return { rpcId: typeof frame.rpcId === 'string' ? frame.rpcId : '', payload: frame }
  }
  return null
}

export function createPendingTracker() {
  const sessions = new Map()
  const bucket = (sessionId) => {
    let row = sessions.get(sessionId)
    if (!row) {
      row = { approvals: new Map(), questions: new Map() }
      sessions.set(sessionId, row)
    }
    return row
  }
  return {
    onFrame(raw) {
      const env = muxEnvelope(raw)
      if (!env) return
      const payload = env.payload
      const sessionId = payload.sessionId
      if (typeof sessionId !== 'string') return
      if (payload.type === 'approval/requested') {
        bucket(sessionId).approvals.set(payload.approvalId, {
          rpcId: env.rpcId,
          approvalId: payload.approvalId,
          toolName: payload.toolName,
          callId: payload.callId,
          reason: payload.reason,
        })
      } else if (payload.type === 'approval/resolved') {
        sessions.get(sessionId)?.approvals.delete(payload.approvalId)
      } else if (payload.type === 'question/requested') {
        bucket(sessionId).questions.set(env.rpcId, {
          rpcId: env.rpcId,
          questions: Array.isArray(payload.questions) ? payload.questions : [],
        })
      } else if (payload.type === 'question/resolved') {
        sessions.get(sessionId)?.questions.delete(payload.questionRpcId)
      }
    },
    pending(sessionId) {
      const row = sessions.get(sessionId)
      if (!row) return { approvals: [], questions: [] }
      return {
        approvals: [...row.approvals.values()],
        questions: [...row.questions.values()],
      }
    },
    findApproval(sessionId, approvalId) {
      return sessions.get(sessionId)?.approvals.get(approvalId)
    },
    findQuestion(sessionId, rpcId) {
      return sessions.get(sessionId)?.questions.get(rpcId)
    },
  }
}

export async function pipeSse(req, res, openFrames, auth, pendingTracker) {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const controller = new AbortController()
  let closed = false
  const ping = setInterval(() => {
    if (auth) auth.touch(req)
    try { res.write(': ping\n\n') } catch { /* ignore */ }
  }, 10_000)
  const onClose = () => {
    if (closed) return
    closed = true
    controller.abort()
    clearInterval(ping)
  }
  res.on('close', onClose)
  req.on('close', onClose)
  try {
    const frames = openFrames(controller.signal)
    for await (const frame of frames) {
      if (closed) break
      if (pendingTracker) pendingTracker.onFrame(frame)
      res.write(`data: ${JSON.stringify(frame)}\n\n`)
    }
  } catch {
    /* EventSource reconnects */
  } finally {
    onClose()
  }
  if (!closed) res.end()
}
