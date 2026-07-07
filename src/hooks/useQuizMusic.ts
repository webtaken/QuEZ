'use client'

import { useEffect, useRef, useState } from 'react'

// Loops a background track during quiz play. start() must be called from a
// user gesture (click) or the browser's autoplay policy rejects play() — the
// rejection is swallowed so the quiz always proceeds, with or without audio.
export function useQuizMusic(file: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  function start() {
    if (!file) return
    if (!audioRef.current) {
      const audio = new Audio(file)
      audio.loop = true
      audio.volume = 0.35
      audioRef.current = audio
    }
    audioRef.current.muted = muted
    audioRef.current.currentTime = 0
    audioRef.current.play().catch(() => {})
  }

  function stop() {
    audioRef.current?.pause()
  }

  function toggleMute() {
    setMuted((m) => {
      const next = !m
      if (audioRef.current) audioRef.current.muted = next
      return next
    })
  }

  return { start, stop, muted, toggleMute }
}
