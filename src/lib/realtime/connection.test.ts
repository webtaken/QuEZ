import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameByCode = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
}))

const syncGameById = vi.fn()
vi.mock('./sync', () => ({
  syncGameById: (...a: unknown[]) => syncGameById(...a),
}))

type ConnectionHandler = (socket: unknown) => Promise<void>
let connectionHandler: ConnectionHandler | null = null
let currentIo: { on: (ev: string, cb: ConnectionHandler) => void } | null = {
  on: (_ev, cb) => {
    connectionHandler = cb
  },
}
vi.mock('./io', () => ({
  getIo: () => currentIo,
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { wireRealtime } = await import('./connection')

function makeSocket(code?: unknown) {
  return {
    handshake: { auth: code === undefined ? {} : { code } },
    join: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }
}

beforeEach(() => {
  getGameByCode.mockReset()
  syncGameById.mockReset()
  connectionHandler = null
})

describe('wireRealtime', () => {
  it('does nothing when no io server exists (build/test contexts)', () => {
    currentIo = null
    expect(() => wireRealtime()).not.toThrow()
    currentIo = { on: (_ev, cb) => (connectionHandler = cb) }
  })

  it('rejects a connection with no code', async () => {
    wireRealtime()
    const socket = makeSocket()
    await connectionHandler!(socket)
    expect(socket.emit).toHaveBeenCalledWith('game:error', { reason: 'not-found' })
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('rejects a connection for an unknown code', async () => {
    getGameByCode.mockResolvedValue(null)
    wireRealtime()
    const socket = makeSocket('000000')
    await connectionHandler!(socket)
    expect(socket.emit).toHaveBeenCalledWith('game:error', { reason: 'not-found' })
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('joins the game-id room (not the code) and syncs', async () => {
    getGameByCode.mockResolvedValue({ id: 'g1', code: '854123' })
    wireRealtime()
    const socket = makeSocket('854123')
    await connectionHandler!(socket)
    expect(socket.join).toHaveBeenCalledWith('g1')
    expect(syncGameById).toHaveBeenCalledWith('g1')
    expect(socket.disconnect).not.toHaveBeenCalled()
  })

  it('catches errors in the connection handler and disconnects the socket', async () => {
    const error = new Error('Database connection failed')
    getGameByCode.mockRejectedValue(error)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      wireRealtime()
      const socket = makeSocket('854123')

      // The handler should resolve without throwing
      await expect(connectionHandler!(socket)).resolves.toBeUndefined()

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('[realtime] connection handler failed:', error)

      // Verify socket was disconnected
      expect(socket.disconnect).toHaveBeenCalledWith(true)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
