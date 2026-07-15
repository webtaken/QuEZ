'use client'

import { useEffect, useState } from 'react'
import { io as createSocket } from 'socket.io-client'
import type { GameErrorReason, GameSnapshot } from '@/lib/realtime/types'
import { snapshotToView, type GameStateView } from '@/lib/realtime/snapshot-view'

// Components import these from the hook module, same as they did from
// useGamePolling — keep all four names exported here.
export type { GameStateView, GameParticipantView } from '@/lib/realtime/snapshot-view'
export type { GameLeaderboardEntry, GameQuestionView } from '@/lib/realtime/types'

export function useGameSocket(code: string, participantId?: string | null) {
  const [state, setState] = useState<GameStateView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const socket = createSocket({ auth: { code } })

    socket.on('game:state', (snapshot: GameSnapshot) => {
      setError(null)
      setState(snapshotToView(snapshot, participantId ?? null))
    })
    socket.on('game:error', ({ reason }: { reason: GameErrorReason }) => {
      setError(reason === 'not-found' ? 'Game not found' : 'The host ended this quiz')
    })
    socket.on('connect_error', () => setError('Connection lost, retrying...'))
    socket.on('disconnect', (reason) => {
      // Socket.IO reconnects on its own; surface the blip like polling did.
      if (reason !== 'io client disconnect') setError('Connection lost, retrying...')
    })

    return () => {
      socket.disconnect()
    }
  }, [code, participantId])

  return { state, error }
}
