'use client'

import { useEffect, useState } from 'react'

// Ticks down from a server-provided phase start time, not a locally-started
// timer — so a page that mounts mid-question (or after a poll delay) still
// shows the correct remaining time instead of restarting from timeLimitSeconds.
export function useCountdown(phaseStartedAt: string, timeLimitSeconds: number) {
  const [secondsLeft, setSecondsLeft] = useState(timeLimitSeconds)

  useEffect(() => {
    const endMs = new Date(phaseStartedAt).getTime() + timeLimitSeconds * 1000

    function tick() {
      setSecondsLeft(Math.max(0, Math.ceil((endMs - Date.now()) / 1000)))
    }

    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [phaseStartedAt, timeLimitSeconds])

  return secondsLeft
}
