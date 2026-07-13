'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Radio, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function HostLiveButton({ quizId, disabled }: { quizId: string; disabled?: boolean }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)

  async function hostLive() {
    setStarting(true)
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to start live game')
      }
      const data = await res.json()
      router.push(`/host/${data.code}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start live game')
      setStarting(false)
    }
  }

  return (
    <Button
      onClick={hostLive}
      disabled={disabled || starting}
      size="sm"
      variant="outline"
      className="gap-1.5"
    >
      {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
      Host live
    </Button>
  )
}
