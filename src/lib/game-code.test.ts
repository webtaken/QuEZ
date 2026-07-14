import { describe, it, expect, vi } from 'vitest'
import { generateUniqueGameCode } from './game-code'

describe('generateUniqueGameCode', () => {
  it('returns a 6-digit numeric string', async () => {
    const codeExists = vi.fn().mockResolvedValue(false)
    const code = await generateUniqueGameCode(codeExists)
    expect(code).toMatch(/^\d{6}$/)
  })

  it('retries on collision until it finds a free code', async () => {
    const codeExists = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const code = await generateUniqueGameCode(codeExists)
    expect(code).toMatch(/^\d{6}$/)
    expect(codeExists).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting maxAttempts', async () => {
    const codeExists = vi.fn().mockResolvedValue(true)
    await expect(generateUniqueGameCode(codeExists, 3)).rejects.toThrow(
      'Could not generate a unique game code'
    )
    expect(codeExists).toHaveBeenCalledTimes(3)
  })
})
