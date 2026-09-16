export async function* createLiveMuxStream(ctx, signal) {
  yield { type: 'ready', clientId: `mp-live-${Date.now().toString(36)}` }
  const queue = []
  let notify = null

  const push = (frame) => {
    queue.push(frame)
    if (notify) {
      const fn = notify
      notify = null
      fn()
    }
  }

  const activeAttempts = new Map()
  const lastSeqs = new Map()

  const dEvent = ctx.on('session/event', (session, event) => {
    const sid = session?.id || session?.sessionId
    if (sid && typeof event?.seq === 'number') {
      lastSeqs.set(sid, Math.max(lastSeqs.get(sid) ?? -1, event.seq))
    }
    push({
      type: 'session/event',
      sessionId: sid,
      event,
    })
  }, { global: true })

  const dStream = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!agent || !frame) return
    const sessionId = agent.session?.id || agent.id
    if (!sessionId) return

    if (frame.type === 'start') {
      activeAttempts.set(sessionId, { turn: frame.turn, step: frame.step })
      return
    }
    if (frame.type === 'end') {
      activeAttempts.delete(sessionId)
      return
    }
    if (frame.type === 'chunk' && frame.chunk) {
      const active = activeAttempts.get(sessionId) || {}
      const turn = frame.turn ?? active.turn ?? 1
      const step = frame.step ?? active.step ?? 1
      const baseSeq = (lastSeqs.get(sessionId) ?? 0) + 1
      const index = typeof frame.index === 'number' ? frame.index : 0
      push({
        type: 'session/event',
        sessionId,
        event: {
          type: 'assistant/chunk',
          seq: baseSeq + (index + 1) * 0.0001,
          time: frame.time || Date.now(),
          data: {
            turn,
            step,
            chunk: frame.chunk,
          },
        },
      })
    }
  }, { global: true })

  const dStatus = ctx.on('api-session/status', (sessionId, running) => {
    push({
      type: 'host/session-status',
      sessionId,
      running: Boolean(running),
    })
  }, { global: true })

  const dAdded = ctx.on('api-session/added', (summary) => {
    push({
      type: 'host/session-added',
      sessionId: summary?.sessionId,
      ...summary,
    })
  }, { global: true })

  const dRemoved = ctx.on('api-session/removed', (sessionId) => {
    push({
      type: 'host/session-removed',
      sessionId,
    })
  }, { global: true })

  const dQuestion = ctx.on('user-questions/request', (req) => {
    push({
      rpcId: req?.rpcId || `q-${Date.now()}`,
      payload: {
        type: 'question/requested',
        sessionId: req?.sessionId || req?.agent?.id,
        questions: req?.questions,
      },
    })
  }, { global: true })

  const dApproval = ctx.on('approval/request', (req) => {
    push({
      rpcId: req?.rpcId || `appr-${Date.now()}`,
      payload: {
        type: 'approval/requested',
        sessionId: req?.sessionId || req?.agent?.id,
        approvalId: req?.approvalId || req?.id,
        toolName: req?.toolName || req?.tool,
        callId: req?.callId,
        reason: req?.reason,
      },
    })
  }, { global: true })

  const onAbort = () => {
    if (notify) {
      const fn = notify
      notify = null
      fn()
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (!signal?.aborted) {
      while (queue.length > 0) {
        yield queue.shift()
      }
      if (signal?.aborted) break
      await new Promise((resolve) => { notify = resolve })
    }
  } finally {
    try { dEvent?.() } catch {}
    try { dStream?.() } catch {}
    try { dStatus?.() } catch {}
    try { dAdded?.() } catch {}
    try { dRemoved?.() } catch {}
    try { dQuestion?.() } catch {}
    try { dApproval?.() } catch {}
  }
}

export async function* createLiveHostStream(ctx, signal) {
  yield { type: 'ready', clientId: `mp-host-${Date.now().toString(36)}` }
  const queue = []
  let notify = null

  const push = (frame) => {
    queue.push(frame)
    if (notify) {
      const fn = notify
      notify = null
      fn()
    }
  }

  const dStatus = ctx.on('api-session/status', (sessionId, running) => {
    push({
      type: 'host/session-status',
      sessionId,
      running: Boolean(running),
    })
  }, { global: true })

  const dAdded = ctx.on('api-session/added', (summary) => {
    push({
      type: 'host/session-added',
      sessionId: summary?.sessionId,
      ...summary,
    })
  }, { global: true })

  const dRemoved = ctx.on('api-session/removed', (sessionId) => {
    push({
      type: 'host/session-removed',
      sessionId,
    })
  }, { global: true })

  const onAbort = () => {
    if (notify) {
      const fn = notify
      notify = null
      fn()
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (!signal?.aborted) {
      while (queue.length > 0) {
        yield queue.shift()
      }
      if (signal?.aborted) break
      await new Promise((resolve) => { notify = resolve })
    }
  } finally {
    try { dStatus?.() } catch {}
    try { dAdded?.() } catch {}
    try { dRemoved?.() } catch {}
  }
}
