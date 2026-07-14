'use client'

// Correct/wrong cues are synthesized tones (Web Audio oscillator), not audio
// files — no licensing/attribution overhead, unlike public/music/*.mp3.
export function useGameSound() {
  function playTone(frequencies: number[], durationMs: number) {
    if (typeof window === 'undefined') return
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const slice = durationMs / 1000 / frequencies.length

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * slice
      const end = start + slice
      gain.gain.setValueAtTime(0.2, start)
      gain.gain.exponentialRampToValueAtTime(0.001, end)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(end)
    })

    window.setTimeout(() => ctx.close(), durationMs + 100)
  }

  return {
    playCorrect: () => playTone([523.25, 783.99], 400), // C5 -> G5, rising chime
    playWrong: () => playTone([196], 500), // low G3 buzz
  }
}
