import { describe, it, expect } from 'vitest'
import { resolveDisconnect } from './useGameSocket'

describe('resolveDisconnect', () => {
  it('ignores a client-initiated disconnect (our own cleanup)', () => {
    expect(resolveDisconnect('io client disconnect', false)).toBe('ignore')
    expect(resolveDisconnect('io client disconnect', true)).toBe('ignore')
  })

  it('keeps the existing game:error message when the server explained itself first', () => {
    expect(resolveDisconnect('io server disconnect', true)).toBe('keep-error')
  })

  it('manually retries a server disconnect with no prior game:error (transient connect-handler failure)', () => {
    expect(resolveDisconnect('io server disconnect', false)).toBe('manual-retry')
  })

  it('auto-retries a transport-level drop (socket.io reconnects on its own)', () => {
    expect(resolveDisconnect('transport close', false)).toBe('auto-retry')
    expect(resolveDisconnect('transport close', true)).toBe('auto-retry')
    expect(resolveDisconnect('ping timeout', false)).toBe('auto-retry')
  })
})
