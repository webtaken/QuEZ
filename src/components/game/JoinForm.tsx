'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function storageKey(code: string) {
  return `quez_game_${code}`
}

export function JoinForm({ initialCode }: { initialCode?: string }) {
  const router = useRouter()
  const [code, setCode] = useState(initialCode ?? '')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedCode = code.trim()
    const trimmedNickname = nickname.trim()
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError('Room code must be 6 digits')
      return
    }
    if (!trimmedNickname) {
      setError('Enter a nickname')
      return
    }

    setJoining(true)
    const key = storageKey(trimmedCode)
    const existing = localStorage.getItem(key)
    const sessionToken = existing ? (JSON.parse(existing).sessionToken as string) : crypto.randomUUID()

    try {
      const res = await fetch(`/api/games/${trimmedCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: trimmedNickname, sessionToken }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to join')
      }
      const data = await res.json()
      localStorage.setItem(key, JSON.stringify({ participantId: data.participantId, sessionToken }))
      router.push(`/game/${trimmedCode}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join')
      setJoining(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm mx-auto px-6 py-16 space-y-5 text-center">
      <h1 className="font-display font-bold text-2xl text-foreground">Join a game</h1>
      <div className="space-y-3 text-left">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Room code</label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="854123"
            inputMode="numeric"
            className="text-center text-2xl tabular-nums tracking-widest h-14"
            maxLength={6}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Nickname</label>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            placeholder="Your name"
            maxLength={20}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        disabled={joining}
        size="lg"
        className="w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-brutal border-2 border-border"
      >
        {joining ? 'Joining...' : 'Join'}
      </Button>
    </form>
  )
}
