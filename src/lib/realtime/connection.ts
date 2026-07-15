import type { Socket } from 'socket.io'
import { getIo } from './io'
import { syncGameById } from './sync'
import { getGameByCode } from '@/db/game-queries'

// Rooms are keyed by game id, not code: codes are recycled once a game hits
// podium, so a code-keyed room could leak a new game's broadcasts to sockets
// still attached to the finished game.
async function handleConnection(socket: Socket): Promise<void> {
  const code = typeof socket.handshake.auth?.code === 'string' ? socket.handshake.auth.code : null
  const game = code ? await getGameByCode(code) : null
  if (!game) {
    socket.emit('game:error', { reason: 'not-found' })
    socket.disconnect(true)
    return
  }
  await socket.join(game.id)
  // Sends the initial snapshot (to the whole room — idempotent) and re-arms
  // the phase timer; after a server restart this is what recovers the game.
  await syncGameById(game.id)
}

export function wireRealtime(): void {
  const io = getIo()
  if (!io) return // next build / vitest — no socket server exists
  // Return the promise (Socket.IO ignores it; the tests await it).
  io.on('connection', (socket) => handleConnection(socket))
}
