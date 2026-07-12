'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MUSIC_TRACKS, getTrackById, type MusicTrackId } from '@/lib/music'

interface MusicPickerProps {
  value: MusicTrackId | null
  onChange: (value: MusicTrackId | null) => void
}

const SELECT_ITEMS = [
  { value: null, label: 'No music' },
  ...MUSIC_TRACKS.map((t) => ({ value: t.id, label: t.name })),
]

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
    if (audioRef.current) {
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
      .then(() => {
        if (audioRef.current === audio) setPreviewing(true)
      })
      .catch(() => {
        if (audioRef.current === audio) stopPreview()
      })
  }

  function handleChange(next: MusicTrackId | null) {
    stopPreview()
    onChange(next)
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={handleChange} items={SELECT_ITEMS}>
        <SelectTrigger className="w-full" aria-label="Background music">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>No music</SelectItem>
          {MUSIC_TRACKS.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        onClick={togglePreview}
        disabled={!value}
        aria-label={previewing ? 'Stop preview' : 'Preview song'}
        className="shrink-0"
      >
        {previewing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
    </div>
  )
}
