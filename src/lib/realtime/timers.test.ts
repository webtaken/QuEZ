import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ensurePhaseTimer } from './timers'
import { getPhaseTimers } from './io'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const { timer } of getPhaseTimers().values()) clearTimeout(timer)
  getPhaseTimers().clear()
  vi.useRealTimers()
})

describe('ensurePhaseTimer', () => {
  it('arms a timer that fires once and removes its map entry', () => {
    const onFire = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, onFire)
    expect(getPhaseTimers().has('g1')).toBe(true)

    vi.advanceTimersByTime(999)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(getPhaseTimers().has('g1')).toBe(false)
  })

  it('keeps the existing timer for the same phaseKey — repeated syncs do not push the deadline back', () => {
    const onFire = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, onFire)
    vi.advanceTimersByTime(600)
    // A re-sync (e.g. a student answering) re-ensures the same phase.
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, onFire)
    vi.advanceTimersByTime(400) // original deadline
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('replaces the timer when the phaseKey changes', () => {
    const first = vi.fn()
    const second = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, first)
    ensurePhaseTimer('g1', { phaseKey: 'reveal:0', delayMs: 500 }, second)
    vi.advanceTimersByTime(1000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('clears the timer when spec is null', () => {
    const onFire = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, onFire)
    ensurePhaseTimer('g1', null, onFire)
    expect(getPhaseTimers().has('g1')).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('tracks timers per game id independently', () => {
    const a = vi.fn()
    const b = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 500 }, a)
    ensurePhaseTimer('g2', { phaseKey: 'question:0', delayMs: 1000 }, b)
    vi.advanceTimersByTime(500)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })
})
