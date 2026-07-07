import { describe, it, expect } from 'vitest'
import { quizPayloadSchema } from './quiz-schema'
import { MUSIC_TRACKS } from './music'

const base = {
  title: 'T',
  description: '',
  topic: 'Math',
  audience: 'High School',
  difficulty: 'medium',
  coverEmoji: '🧠',
  questions: [],
}

describe('quizPayloadSchema musicTrack', () => {
  it('accepts a known track id', () => {
    const r = quizPayloadSchema.safeParse({ ...base, musicTrack: MUSIC_TRACKS[0].id })
    expect(r.success).toBe(true)
  })

  it('accepts null', () => {
    const r = quizPayloadSchema.safeParse({ ...base, musicTrack: null })
    expect(r.success).toBe(true)
  })

  it('accepts an omitted musicTrack', () => {
    const r = quizPayloadSchema.safeParse(base)
    expect(r.success).toBe(true)
  })

  it('rejects an unknown track id', () => {
    const r = quizPayloadSchema.safeParse({ ...base, musicTrack: 'not-a-track' })
    expect(r.success).toBe(false)
  })
})
