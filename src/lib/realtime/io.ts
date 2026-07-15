import type { Server } from 'socket.io'

// server.mjs (plain JS, outside Next's compiled graph) sets globalThis.__quezIo
// before Next boots. Next bundles instrumentation.ts, route handlers, and lib
// modules as separate module graphs, so module-scope singletons silently
// duplicate — every cross-module mutable singleton must live on globalThis.
export type PhaseTimerEntry = { phaseKey: string; timer: NodeJS.Timeout }

type RealtimeGlobal = typeof globalThis & {
  __quezIo?: Server
  __quezPhaseTimers?: Map<string, PhaseTimerEntry>
  __quezSyncChains?: Map<string, Promise<void>>
}

export function getIo(): Server | null {
  return (globalThis as RealtimeGlobal).__quezIo ?? null
}

export function getPhaseTimers(): Map<string, PhaseTimerEntry> {
  const g = globalThis as RealtimeGlobal
  g.__quezPhaseTimers ??= new Map()
  return g.__quezPhaseTimers
}

export function getSyncChains(): Map<string, Promise<void>> {
  const g = globalThis as RealtimeGlobal
  g.__quezSyncChains ??= new Map()
  return g.__quezSyncChains
}
