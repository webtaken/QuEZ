'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useGamePolling } from '@/hooks/useGamePolling'
import { StudentWaitingRoom } from './StudentWaitingRoom'
import { StudentQuestionLive } from './StudentQuestionLive'
import { StudentReveal } from './StudentReveal'
import { StudentPodium } from './StudentPodium'

function storageKey(code: string) {
  return `quez_game_${code}`
}

export function StudentGameView({ code }: { code: string }) {
  const router = useRouter()
  // undefined = not yet read from localStorage, null = no join found (redirecting)
  const [participantId, setParticipantId] = useState<string | null | undefined>(undefined)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [answeredQuestionIndex, setAnsweredQuestionIndex] = useState<number | null>(null)

  useEffect(() => {
    const raw = localStorage.getItem(storageKey(code))
    if (!raw) {
      router.replace(`/join/${code}`)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParticipantId(null)
      return
    }
    const parsed = JSON.parse(raw) as { participantId: string }
    setParticipantId(parsed.participantId)
  }, [code, router])

  const { state, error } = useGamePolling(code, participantId ?? undefined)

  if (participantId === undefined || participantId === null) return null

  if (error) {
    return (
      <div className="max-w-md mx-auto pt-24 text-center">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }
  if (!state) {
    return <div className="max-w-md mx-auto pt-24 text-center text-muted-foreground">Loading game...</div>
  }
  if (state.you?.kickedAt) {
    return (
      <div className="max-w-md mx-auto pt-24 text-center">
        <p className="text-destructive font-semibold">You were removed from this game by the host.</p>
      </div>
    )
  }

  function recordAnswer(index: number | null) {
    setSelectedIndex(index)
    setAnsweredQuestionIndex(state!.currentQuestionIndex)
  }

  if (state.status === 'waiting') {
    return <StudentWaitingRoom participants={state.participants} you={state.you} />
  }
  if (state.status === 'question' && state.question) {
    return (
      <StudentQuestionLive
        code={code}
        participantId={participantId}
        question={state.question}
        phaseStartedAt={state.phaseStartedAt}
        currentQuestionIndex={state.currentQuestionIndex}
        onAnswered={recordAnswer}
      />
    )
  }
  if (state.status === 'reveal' && state.question && state.you) {
    return (
      <StudentReveal
        key={state.currentQuestionIndex}
        question={state.question}
        correctIndex={state.correctIndex ?? -1}
        selectedIndex={answeredQuestionIndex === state.currentQuestionIndex ? selectedIndex : null}
        you={state.you}
      />
    )
  }
  if (state.status === 'podium') {
    return <StudentPodium leaderboard={state.leaderboard ?? []} you={state.you} />
  }
  return null
}
