import { getPhaseTimers } from './io'

export type PhaseTimerSpec = { phaseKey: string; delayMs: number }

// Idempotent: called on every sync (connect, mutation, timer fire). Keeps an
// existing timer for the same phase (same phaseKey) so repeated syncs don't
// push the deadline back; replaces it when the phase changed; clears it when
// the phase needs no timer (waiting, non-final reveal, podium, deleted game).
export function ensurePhaseTimer(gameId: string, spec: PhaseTimerSpec | null, onFire: () => void): void {
  const timers = getPhaseTimers()
  const existing = timers.get(gameId)
  if (existing && spec && existing.phaseKey === spec.phaseKey) return
  if (existing) {
    clearTimeout(existing.timer)
    timers.delete(gameId)
  }
  if (!spec) return
  const timer = setTimeout(() => {
    timers.delete(gameId)
    onFire()
  }, spec.delayMs)
  timers.set(gameId, { phaseKey: spec.phaseKey, timer })
}
