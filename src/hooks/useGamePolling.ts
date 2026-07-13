'use client'

import { useEffect, useState } from 'react'

export type GameParticipantView = { id: string; nickname: string; score: number; answered: boolean }
export type GameLeaderboardEntry = {
  id: string
  nickname: string
  score: number
  totalAnswerMs: number
  rank: number
}
export type GameQuestionView = { id: string; text: string; options: string[]; timeLimit: number }
export type GameStateView = {
  status: 'waiting' | 'question' | 'reveal' | 'podium'
  currentQuestionIndex: number
  totalQuestions: number
  phaseStartedAt: string
  participants: GameParticipantView[]
  you: { id: string; nickname: string; score: number; streak: number; kickedAt: string | null } | null
  question?: GameQuestionView
  correctIndex?: number
  leaderboard?: GameLeaderboardEntry[]
}

const POLL_MS = 1500

export function useGamePolling(code: string, participantId?: string | null) {
  const [state, setState] = useState<GameStateView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const qs = participantId ? `?participantId=${encodeURIComponent(participantId)}` : ''
        const res = await fetch(`/api/games/${code}/state${qs}`, { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          setError(res.status === 404 ? 'Game not found' : 'Failed to load game')
          return
        }
        const data = (await res.json()) as GameStateView
        setError(null)
        setState(data)
      } catch {
        if (!cancelled) setError('Connection lost, retrying...')
      }
    }

    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [code, participantId])

  return { state, error }
}
