import { randomBytes } from 'node:crypto'

/**
 * 远程云服务器一键初始化与部署 JackDSH Relay 服务
 * 采用用完即焚策略：执行完部署脚本后立即销毁 SSH 连接与凭据，绝不落盘保存服务器密码。
 */
export async function provisionRemoteRelay(options, onProgress = () => {}) {
  const {
    host,
    port = 22,
    username = 'root',
    password,
    privateKey,
    relayPort = 13080,
    domain = '',
  } = options

  if (!host) throw new Error('服务器 IP 地址不能为空')
  if (!password && !privateKey) throw new Error('必须提供 SSH 密码或私钥')

  onProgress({ step: 1, text: `正在连接云服务器 ${host}:${port}...` })

  // 动态导入 ssh2
  let Client
  try {
    const mod = await import('ssh2')
    Client = mod.Client || mod.default?.Client
  } catch (err) {
    throw new Error(`缺少 ssh2 依赖: ${err.message}`)
  }

  const conn = new Client()

  const executeCommand = (cmd) => {
    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        stream.on('close', (code) => {
          if (code === 0) {
            resolve(stdout)
          } else {
            reject(new Error(`命令执行失败 (退出码 ${code}): ${stderr || stdout}`))
          }
        })
        stream.on('data', (data) => {
          stdout += data.toString()
        })
        stream.stderr.on('data', (data) => {
          stderr += data.toString()
        })
      })
    })
  }

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve)
    conn.on('error', reject)
    conn.connect({
      host,
      port: parseInt(port, 10),
      username,
      password: password || undefined,
      privateKey: privateKey || undefined,
      readyTimeout: 15000,
    })
  })

  try {
    onProgress({ step: 2, text: '检查服务器 Node.js 与运行环境...' })
    let hasNode = false
    try {
      const nodeVer = await executeCommand('node -v')
      if (nodeVer.startsWith('v')) hasNode = true
    } catch {}

    if (!hasNode) {
      onProgress({ step: 2, text: '正在安装 Node.js 运行时环境 (可能需要 1~2 分钟)...' })
      const installNodeCmd = `
        if which apt-get >/dev/null 2>&1; then
          curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
        elif which yum >/dev/null 2>&1; then
          curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && yum install -y nodejs
        elif which dnf >/dev/null 2>&1; then
          curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && dnf install -y nodejs
        else
          echo "No supported package manager found" && exit 1
        fi
      `
      await executeCommand(installNodeCmd)
    }

    onProgress({ step: 3, text: '部署 JackDSH Relay 服务端文件到 /opt/jackdsh-relay...' })
    await executeCommand('mkdir -p /opt/jackdsh-relay')

    // 写入 package.json
    const packageJsonContent = JSON.stringify(
      {
        name: 'jackdsh-relay',
        version: '1.0.0',
        type: 'module',
        main: 'server.mjs',
        dependencies: { ws: '^8.18.0' },
      },
      null,
      2,
    )
    await executeCommand(`cat << 'EOF' > /opt/jackdsh-relay/package.json\n${packageJsonContent}\nEOF`)

    // 生成安全 Token
    const generatedToken = `jackdsh_sec_${randomBytes(16).toString('hex')}`

    // 写入极简轻量中继服务端代码
    const serverScript = `import { createServer } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '${relayPort}', 10);
const HOST = '0.0.0.0';
const RELAY_TOKEN = '${generatedToken}';

let activeClient = null;
const pendingRequests = new Map();

const server = createServer((req, res) => {
  const parsed = parseUrl(req.url, true);
  if (parsed.pathname === '/relay/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (parsed.pathname === '/relay/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      clientConnected: activeClient !== null && activeClient.ws.readyState === WebSocket.OPEN,
      activeRequests: pendingRequests.size
    }));
  }
  if (!activeClient || activeClient.ws.readyState !== WebSocket.OPEN) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<!DOCTYPE html><html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;"><h2>JackDSH 客户端未在线</h2><p>云端中继正常，请启动电脑端 JackDSH 客户端。</p></body></html>');
  }

  const reqId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const timeoutTimer = setTimeout(() => {
    if (pendingRequests.has(reqId)) {
      pendingRequests.delete(reqId);
      if (!res.headersSent) res.writeHead(504).end('Gateway Timeout');
      else res.destroy();
    }
  }, 60000);
  pendingRequests.set(reqId, { req, res, timeoutTimer });

  const headers = { ...req.headers };
  headers['x-forwarded-for'] = req.socket.remoteAddress || '';
  activeClient.send(JSON.stringify({ type: 'req_start', reqId, method: req.method, url: req.url, headers }));
  req.on('data', (chunk) => {
    if (activeClient?.ws.readyState === WebSocket.OPEN) {
      activeClient.send(JSON.stringify({ type: 'req_data', reqId, chunk: chunk.toString('base64') }));
    }
  });
  req.on('end', () => {
    if (activeClient?.ws.readyState === WebSocket.OPEN) {
      activeClient.send(JSON.stringify({ type: 'req_end', reqId }));
    }
  });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const parsed = parseUrl(req.url, true);
  if (parsed.pathname !== '/relay/tunnel') return socket.destroy();
  const token = parsed.query.token || req.headers['x-relay-token'];
  if (!token || token !== RELAY_TOKEN) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  if (activeClient) try { activeClient.ws.close(1000); } catch {}
  activeClient = { ws, send: (m) => ws.readyState === WebSocket.OPEN && ws.send(m) };
  activeClient.send(JSON.stringify({ type: 'connected' }));
  ws.on('message', (d) => {
    try {
      const msg = JSON.parse(d.toString());
      if (msg.type === 'pong') return;
      if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
      const pending = pendingRequests.get(msg.reqId);
      if (!pending) return;
      if (msg.type === 'res_start') {
        clearTimeout(pending.timeoutTimer);
        const h = { ...msg.headers };
        delete h['transfer-encoding'];
        return pending.res.writeHead(msg.status || 200, h);
      }
      if (msg.type === 'res_data' && msg.chunk) return pending.res.write(Buffer.from(msg.chunk, 'base64'));
      if (msg.type === 'res_end') { pending.res.end(); return pendingRequests.delete(msg.reqId); }
    } catch {}
  });
  ws.on('close', () => { if (activeClient?.ws === ws) activeClient = null; });
});

server.listen(PORT, HOST, () => console.log('Relay listening on ' + PORT));
`
    await executeCommand(`cat << 'EOF' > /opt/jackdsh-relay/server.mjs\n${serverScript}\nEOF`)

    // 安装依赖
    onProgress({ step: 3, text: '安装依赖 (ws)...' })
    await executeCommand('cd /opt/jackdsh-relay && (npm --registry=https://registry.npmmirror.com install --omit=dev || npm install --omit=dev)')

    // 注册并启动 systemd
    onProgress({ step: 4, text: '配置 systemd 系统开机自启并启动服务...' })
    const systemdService = `[Unit]
Description=JackDSH Universal Relay Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/jackdsh-relay
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3
Environment=PORT=${relayPort}

[Install]
WantedBy=multi-user.target
`
    await executeCommand(`cat << 'EOF' > /etc/systemd/system/jackdsh-relay.service\n${systemdService}\nEOF`)
    await executeCommand('systemctl daemon-reload && systemctl enable --now jackdsh-relay')

    // 放行防火墙端口
    try {
      await executeCommand(`ufw allow ${relayPort}/tcp 2>/dev/null || (firewall-cmd --add-port=${relayPort}/tcp --permanent 2>/dev/null && firewall-cmd --reload 2>/dev/null) || true`)
    } catch {}

    onProgress({ step: 5, text: '自检服务就绪状态...' })
    const health = await executeCommand(`curl -s http://127.0.0.1:${relayPort}/relay/health || echo 'failed'`)
    if (!health.includes('ok')) {
      throw new Error(`服务启动自检失败: ${health}`)
    }

    const publicBaseUrl = domain.trim() ? domain.trim().replace(/\/$/, '') : `http://${host}:${relayPort}`
    const serverWsUrl = domain.trim()
      ? (domain.startsWith('https://') ? domain.replace(/^https:\/\//, 'wss://') : domain.replace(/^http:\/\//, 'ws://')) + '/relay/tunnel'
      : `ws://${host}:${relayPort}/relay/tunnel`

    const finalConfig = {
      enabled: true,
      server: serverWsUrl,
      token: generatedToken,
      publicBaseUrl,
      updatedAt: new Date().toISOString(),
    }

    onProgress({ step: 6, text: '云端部署大获全胜！' })
    return finalConfig
  } finally {
    // 强制断开 SSH，用完即焚
    try {
      conn.end()
    } catch {}
  }
}
