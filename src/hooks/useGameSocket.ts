'use client'

import { useEffect, useState } from 'react'
import { io as createSocket } from 'socket.io-client'
import type { GameErrorReason, GameSnapshot } from '@/lib/realtime/types'
import { snapshotToView, type GameStateView } from '@/lib/realtime/snapshot-view'

// Components import these from the hook module, same as they did from
// useGamePolling — keep all four names exported here.
export type { GameStateView, GameParticipantView } from '@/lib/realtime/snapshot-view'
export type { GameLeaderboardEntry, GameQuestionView } from '@/lib/realtime/types'

const MANUAL_RETRY_DELAY_MS = 2000

export type DisconnectAction = 'ignore' | 'keep-error' | 'manual-retry' | 'auto-retry'

// The server hangs up in two situations: it already explained why via
// game:error (e.g. 'not-found') right before disconnecting — keep that
// message, don't overwrite it — or its connection handler failed
// transiently with no prior game:error. socket.io never auto-reconnects
// after a server-initiated disconnect, so the transient case needs a
// manual socket.connect(). A transport-level drop (network blip) is the
// only case socket.io retries on its own.
export function resolveDisconnect(reason: string, hasError: boolean): DisconnectAction {
  if (reason === 'io client disconnect') return 'ignore'
  if (reason === 'io server disconnect') return hasError ? 'keep-error' : 'manual-retry'
  return 'auto-retry'
}

export function useGameSocket(code: string, participantId?: string | null) {
  const [state, setState] = useState<GameStateView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const socket = createSocket({ auth: { code, participantId: participantId ?? undefined } })
    const errorRef = { current: false }
    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    let kickedHandled = false

    socket.on('game:state', (snapshot: GameSnapshot) => {
      errorRef.current = false
      setError(null)
      const view = snapshotToView(snapshot, participantId ?? null)
      setState(view)
      // Spec: a kicked client shows "removed by host" and closes its socket.
      // Guard so a subsequent broadcast doesn't re-trigger the disconnect.
      if (view.you?.kickedAt && !kickedHandled) {
        kickedHandled = true
        socket.disconnect()
      }
    })
    socket.on('game:error', ({ reason }: { reason: GameErrorReason }) => {
      errorRef.current = true
      setError(reason === 'not-found' ? 'Game not found' : 'The host ended this quiz')
    })
    socket.on('connect_error', () => setError('Connection lost, retrying...'))
    socket.on('disconnect', (reason) => {
      const action = resolveDisconnect(reason, errorRef.current)
      if (action === 'ignore' || action === 'keep-error') return
      setError('Connection lost, retrying...')
      if (action === 'manual-retry') {
        retryTimeout = setTimeout(() => socket.connect(), MANUAL_RETRY_DELAY_MS)
      }
    })

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout)
      socket.disconnect()
    }
  }, [code, participantId])

  return { state, error }
}
