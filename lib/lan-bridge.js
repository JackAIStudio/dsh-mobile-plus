import net from 'node:net'

export class LanBridge {
  /**
   * @param {number} targetPort - DSH local loopback port (e.g. 3080)
   * @param {number} [preferredPort=3088] - preferred LAN listening port
   */
  constructor(targetPort, preferredPort = 3088) {
    this.targetPort = targetPort
    this.preferredPort = preferredPort
    this.server = null
    this.listeningPort = 0
  }

  /**
   * Start listening on 0.0.0.0 for LAN traffic and forwarding to loopback target
   * @returns {Promise<number>} bound LAN port, or 0 if failed
   */
  async start() {
    for (let offset = 0; offset < 20; offset++) {
      const candidate = this.preferredPort + offset
      if (candidate === this.targetPort) continue
      try {
        await this.tryListen(candidate)
        this.listeningPort = candidate
        return candidate
      } catch (err) {
        if (err.code !== 'EADDRINUSE') {
          break
        }
      }
    }
    return 0
  }

  tryListen(port) {
    return new Promise((resolve, reject) => {
      const server = net.createServer((clientSocket) => {
        const targetSocket = net.connect(this.targetPort, '127.0.0.1')

        clientSocket.on('error', () => {
          targetSocket.destroy()
        })
        targetSocket.on('error', () => {
          clientSocket.destroy()
        })

        clientSocket.pipe(targetSocket)
        targetSocket.pipe(clientSocket)
      })

      server.once('error', (err) => {
        server.close()
        reject(err)
      })

      server.listen(port, '0.0.0.0', () => {
        this.server = server
        resolve(port)
      })
    })
  }

  stop() {
    if (this.server) {
      try {
        this.server.close()
      } catch {}
      this.server = null
      this.listeningPort = 0
    }
  }
}
