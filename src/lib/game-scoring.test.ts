import { describe, it, expect } from 'vitest'
import { computePoints, rankParticipants } from './game-scoring'

describe('computePoints', () => {
  it('awards full points for an instant correct answer, no streak', () => {
    expect(computePoints(30000, 0, true, 0)).toBe(1000)
  })

  it('awards half points for a correct answer at the very last instant', () => {
    expect(computePoints(30000, 30000, true, 0)).toBe(500)
  })

  it('scales linearly between instant and last-instant', () => {
    // half the time elapsed -> 3/4 of max points
    expect(computePoints(20000, 10000, true, 0)).toBe(750)
  })

  it('awards 0 for a wrong answer regardless of speed or streak', () => {
    expect(computePoints(30000, 0, false, 5)).toBe(0)
  })

  it('awards 0 for a timed-out (no) answer', () => {
    expect(computePoints(30000, 30000, false, 3)).toBe(0)
  })

  it('applies a 10%-per-streak bonus on top of base points', () => {
    expect(computePoints(30000, 0, true, 3)).toBe(1300)
  })

  it('caps the streak bonus at a 5-streak (+50%)', () => {
    expect(computePoints(30000, 0, true, 5)).toBe(1500)
    expect(computePoints(30000, 0, true, 10)).toBe(1500)
  })
})

describe('rankParticipants', () => {
  it('sorts by score descending', () => {
    const result = rankParticipants([
      { id: 'a', score: 100, totalAnswerMs: 5000 },
      { id: 'b', score: 300, totalAnswerMs: 5000 },
      { id: 'c', score: 200, totalAnswerMs: 5000 },
    ])
    expect(result.map((p) => p.id)).toEqual(['b', 'c', 'a'])
    expect(result.map((p) => p.rank)).toEqual([1, 2, 3])
  })

  it('breaks a score tie by lower totalAnswerMs (faster overall)', () => {
    const result = rankParticipants([
      { id: 'slow', score: 100, totalAnswerMs: 9000 },
      { id: 'fast', score: 100, totalAnswerMs: 3000 },
    ])
    expect(result.map((p) => p.id)).toEqual(['fast', 'slow'])
  })

  it('does not mutate the input array', () => {
    const input = [
      { id: 'a', score: 1, totalAnswerMs: 1 },
      { id: 'b', score: 2, totalAnswerMs: 1 },
    ]
    const copy = [...input]
    rankParticipants(input)
    expect(input).toEqual(copy)
  })
})
