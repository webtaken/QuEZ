'use client'

import { useCallback, useEffect, useState } from 'react'

export function useCredits() {
  const [balance, setBalance] = useState<number | null>(null)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/credits')
      if (!res.ok) return
      const data: { balance: number } = await res.json()
      setBalance(data.balance)
    } catch {
      // Badge just stays stale — never surface fetch noise to the user.
    }
  }, [])

  useEffect(() => {
    // refetch is async — setBalance fires after an await, not synchronously
    // within this effect body, so this is a false positive on the rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch()
  }, [refetch])

  return { balance, refetch }
}
