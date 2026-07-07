import { describe, it, expect } from 'vitest'
import { MUSIC_TRACKS, MUSIC_TRACK_IDS, getTrackById } from './music'

describe('MUSIC_TRACKS', () => {
  it('has at least one track, each with id, name, and a /music/ file path', () => {
    expect(MUSIC_TRACKS.length).toBeGreaterThan(0)
    for (const t of MUSIC_TRACKS) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.file).toMatch(/^\/music\/.+\.mp3$/)
    }
  })

  it('has unique ids', () => {
    const ids = MUSIC_TRACKS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('MUSIC_TRACK_IDS mirrors MUSIC_TRACKS ids', () => {
    expect(MUSIC_TRACK_IDS).toEqual(MUSIC_TRACKS.map((t) => t.id))
  })
})

describe('getTrackById', () => {
  it('returns the track for a known id', () => {
    const first = MUSIC_TRACKS[0]
    expect(getTrackById(first.id)).toEqual(first)
  })

  it('returns null for an unknown id', () => {
    expect(getTrackById('does-not-exist')).toBeNull()
  })

  it('returns null for null and undefined', () => {
    expect(getTrackById(null)).toBeNull()
    expect(getTrackById(undefined)).toBeNull()
  })
})
