import { createServer } from 'node:http'
import next from 'next'
import { Server } from 'socket.io'

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

const httpServer = createServer()

// destroyUpgrade: false — engine.io must not kill upgrade requests it doesn't
// own (Next's dev HMR websocket shares this server).
const io = new Server(httpServer, { destroyUpgrade: false })

// Contract with src/lib/realtime/io.ts (getIo): set BEFORE app.prepare() so
// instrumentation.ts register() finds it. This file stays plain JS — it runs
// outside Next's compiler and cannot import TS modules.
globalThis.__quezIo = io

// httpServer passed so Next attaches its own upgrade handling (dev HMR).
const app = next({ dev, hostname, port, httpServer })
const handle = app.getRequestHandler()

app.prepare()
  .then(() => {
    httpServer.on('request', (req, res) => {
      // engine.io answers /socket.io/* itself; without this guard Next would
      // also try to handle those requests and double-write the response.
      if (req.url && req.url.startsWith('/socket.io/')) return
      handle(req, res)
    })
    httpServer.listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port} (${dev ? 'dev' : 'production'})`)
    })
  })
  .catch((err) => {
    console.error('[server] Next.js failed to prepare:', err)
    process.exit(1)
  })
