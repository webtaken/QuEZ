import { describe, it, expect } from 'vitest'
import { snapshotToView } from './snapshot-view'
import type { GameSnapshot } from './types'

const SNAPSHOT: GameSnapshot = {
  status: 'question',
  currentQuestionIndex: 0,
  totalQuestions: 3,
  phaseStartedAt: '2026-01-01T00:00:00.000Z',
  participants: [
    { id: 'p1', nickname: 'Ana', score: 100, streak: 2, answered: true, kickedAt: null },
    { id: 'p2', nickname: 'Bad', score: 0, streak: 0, answered: false, kickedAt: '2026-01-01T00:01:00.000Z' },
  ],
  question: { id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30 },
}

describe('snapshotToView', () => {
  it('filters kicked participants out of the roster', () => {
    const view = snapshotToView(SNAPSHOT, null)
    expect(view.participants).toEqual([{ id: 'p1', nickname: 'Ana', score: 100, answered: true }])
  })

  it('derives "you" from the full list — a kicked participant still finds themselves', () => {
    const view = snapshotToView(SNAPSHOT, 'p2')
    expect(view.you).toEqual({
      id: 'p2',
      nickname: 'Bad',
      score: 0,
      streak: 0,
      kickedAt: '2026-01-01T00:01:00.000Z',
    })
    expect(view.participants.find((p) => p.id === 'p2')).toBeUndefined()
  })

  it('returns you: null without a participantId or for an unknown id', () => {
    expect(snapshotToView(SNAPSHOT, null).you).toBeNull()
    expect(snapshotToView(SNAPSHOT, 'ghost').you).toBeNull()
  })

  it('passes status, indices, question, correctIndex, and leaderboard through', () => {
    const reveal: GameSnapshot = {
      ...SNAPSHOT,
      status: 'reveal',
      correctIndex: 1,
      leaderboard: [{ id: 'p1', nickname: 'Ana', score: 100, totalAnswerMs: 5000, rank: 1 }],
    }
    const view = snapshotToView(reveal, 'p1')
    expect(view.status).toBe('reveal')
    expect(view.question).toEqual(SNAPSHOT.question)
    expect(view.correctIndex).toBe(1)
    expect(view.leaderboard).toEqual(reveal.leaderboard)
    expect(view.phaseStartedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(view.totalQuestions).toBe(3)
  })
})
