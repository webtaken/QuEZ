'use client'

import { useGamePolling } from '@/hooks/useGamePolling'
import { HostWaitingRoom } from './HostWaitingRoom'
import { HostQuestionLive } from './HostQuestionLive'
import { HostReveal } from './HostReveal'
import { HostPodium } from './HostPodium'

export function HostGameView({
  code,
  quizTitle,
  coverEmoji,
}: {
  code: string
  quizTitle: string
  coverEmoji: string
}) {
  const { state, error } = useGamePolling(code)

  async function post(path: string, body?: unknown) {
    await fetch(`/api/games/${code}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  if (error) {
    return <div className="max-w-md mx-auto pt-24 text-center text-destructive">{error}</div>
  }
  if (!state) {
    return <div className="max-w-md mx-auto pt-24 text-center text-muted-foreground">Loading game...</div>
  }

  if (state.status === 'waiting') {
    return (
      <HostWaitingRoom
        code={code}
        quizTitle={quizTitle}
        coverEmoji={coverEmoji}
        participants={state.participants}
        onKick={(participantId) => post('/kick', { participantId })}
        onStart={() => post('/start')}
      />
    )
  }
  if (state.status === 'question' && state.question) {
    return (
      <HostQuestionLive
        question={state.question}
        currentQuestionIndex={state.currentQuestionIndex}
        totalQuestions={state.totalQuestions}
        phaseStartedAt={state.phaseStartedAt}
        participants={state.participants}
      />
    )
  }
  if (state.status === 'reveal' && state.question) {
    return (
      <HostReveal
        key={state.currentQuestionIndex}
        question={state.question}
        correctIndex={state.correctIndex ?? -1}
        currentQuestionIndex={state.currentQuestionIndex}
        totalQuestions={state.totalQuestions}
        leaderboard={state.leaderboard ?? []}
        onAdvance={() => post('/advance')}
      />
    )
  }
  if (state.status === 'podium') {
    return <HostPodium leaderboard={state.leaderboard ?? []} quizTitle={quizTitle} coverEmoji={coverEmoji} />
  }
  return null
}
