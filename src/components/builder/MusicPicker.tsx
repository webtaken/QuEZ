'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MUSIC_TRACKS, getTrackById, type MusicTrackId } from '@/lib/music'

interface MusicPickerProps {
  value: MusicTrackId | null
  onChange: (value: MusicTrackId | null) => void
}

export function MusicPicker({ value, onChange }: MusicPickerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  function stopPreview() {
    audioRef.current?.pause()
    audioRef.current = null
    setPreviewing(false)
  }

  function togglePreview() {
    if (previewing) {
      stopPreview()
      return
    }
    const track = getTrackById(value)
    if (!track) return
    const audio = new Audio(track.file)
    audio.loop = true
    audio.volume = 0.5
    audioRef.current = audio
    audio
      .play()
      .then(() => setPreviewing(true))
      .catch(() => stopPreview())
  }

  function handleChange(next: string) {
    stopPreview()
    onChange(next === '' ? null : (next as MusicTrackId))
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Background music"
        className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      >
        <option value="">No music</option>
        {MUSIC_TRACKS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="icon"
        onClick={togglePreview}
        disabled={!value}
        aria-label={previewing ? 'Stop preview' : 'Preview song'}
        className="shrink-0 h-9 w-9"
      >
        {previewing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
    </div>
  )
}
