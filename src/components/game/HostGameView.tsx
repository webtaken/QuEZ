'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useGamePolling } from '@/hooks/useGamePolling'
import { useQuizMusic } from '@/hooks/useQuizMusic'
import { getTrackById } from '@/lib/music'
import { HostWaitingRoom } from './HostWaitingRoom'
import { HostQuestionLive } from './HostQuestionLive'
import { HostReveal } from './HostReveal'
import { HostPodium } from './HostPodium'

export function HostGameView({
  code,
  quizTitle,
  coverEmoji,
  musicTrack,
}: {
  code: string
  quizTitle: string
  coverEmoji: string
  musicTrack: string | null
}) {
  const { state, error } = useGamePolling(code)
  const track = getTrackById(musicTrack)
  const music = useQuizMusic(track?.file ?? null)

  const status = state?.status
  useEffect(() => {
    if (status === 'podium') music.stop()
    // music's functions are re-created every render; status is the only
    // real input, and stop() is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function post(path: string, body?: unknown) {
    await fetch(`/api/games/${code}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  let view: ReactNode = null
  if (error) {
    view = <div className="max-w-md mx-auto pt-24 text-center text-destructive">{error}</div>
  } else if (!state) {
    view = <div className="max-w-md mx-auto pt-24 text-center text-muted-foreground">Loading game...</div>
  } else if (state.status === 'waiting') {
    view = (
      <HostWaitingRoom
        code={code}
        quizTitle={quizTitle}
        coverEmoji={coverEmoji}
        participants={state.participants}
        onKick={(participantId) => post('/kick', { participantId })}
        onStart={() => {
          // start() must run inside the click gesture or autoplay is blocked.
          music.start()
          post('/start')
        }}
      />
    )
  } else if (state.status === 'question' && state.question) {
    view = (
      <HostQuestionLive
        question={state.question}
        currentQuestionIndex={state.currentQuestionIndex}
        totalQuestions={state.totalQuestions}
        phaseStartedAt={state.phaseStartedAt}
        participants={state.participants}
      />
    )
  } else if (state.status === 'reveal' && state.question) {
    view = (
      <HostReveal
        key={state.currentQuestionIndex}
        question={state.question}
        correctIndex={state.correctIndex ?? -1}
        currentQuestionIndex={state.currentQuestionIndex}
        totalQuestions={state.totalQuestions}
        leaderboard={state.leaderboard ?? []}
        onAdvance={() => {
          // No-op while music already plays; restores it one click after a
          // mid-game host refresh (refresh loses autoplay permission).
          music.resume()
          post('/advance')
        }}
      />
    )
  } else if (state.status === 'podium') {
    view = <HostPodium leaderboard={state.leaderboard ?? []} quizTitle={quizTitle} coverEmoji={coverEmoji} />
  }

  return (
    <>
      {track && (status === 'question' || status === 'reveal') && (
        <button
          onClick={music.toggleMute}
          aria-label={music.muted ? 'Unmute music' : 'Mute music'}
          className="fixed top-4 right-4 z-10 text-muted-foreground hover:text-foreground transition-colors"
        >
          {music.muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
      )}
      {view}
    </>
  )
}
