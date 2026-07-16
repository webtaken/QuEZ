import { describe, it, expect } from 'vitest'
import {
  usdToCredits,
  computeDebit,
  formatCredits,
  MIN_DEBIT_CREDITS,
  SIGNUP_GRANT_CREDITS,
} from './credit-math'

describe('usdToCredits', () => {
  it('applies the 5x margin at 1 credit = $0.01', () => {
    expect(usdToCredits(0.001)).toBeCloseTo(0.5)
    expect(usdToCredits(0.005)).toBeCloseTo(2.5)
    expect(usdToCredits(0)).toBe(0)
  })
})

describe('computeDebit', () => {
  const step = (cost?: number) => ({
    providerMetadata: { openrouter: { usage: cost === undefined ? {} : { cost } } },
  })

  it('sums OpenRouter-reported cost across steps', () => {
    const out = computeDebit({ steps: [step(0.001), step(0.002)], totalTokens: 9999 })
    expect(out.rawCostUsd).toBeCloseTo(0.003)
    expect(out.credits).toBeCloseTo(1.5)
    expect(out.usedFallback).toBe(false)
  })

  it('ignores steps without cost when at least one reports it', () => {
    const out = computeDebit({ steps: [step(undefined), step(0.002)], totalTokens: 9999 })
    expect(out.rawCostUsd).toBeCloseTo(0.002)
    expect(out.usedFallback).toBe(false)
  })

  it('falls back to token pricing when no step reports cost', () => {
    const out = computeDebit({ steps: [step(undefined), {}], totalTokens: 10_000 })
    expect(out.rawCostUsd).toBeCloseTo(0.02) // 10_000 * 0.000002
    expect(out.credits).toBeCloseTo(10)
    expect(out.usedFallback).toBe(true)
  })

  it('never debits below the minimum for a completed generation', () => {
    const zeroCost = computeDebit({ steps: [step(0)], totalTokens: 0 })
    expect(zeroCost.credits).toBe(MIN_DEBIT_CREDITS)
    const noInfo = computeDebit({ steps: [], totalTokens: undefined })
    expect(noInfo.credits).toBe(MIN_DEBIT_CREDITS)
  })

  it('clamps a reported positive cost that converts below the minimum', () => {
    // 0.00001 * MARGIN(5) / CREDIT_USD_VALUE(0.01) = 0.005 credits, below MIN_DEBIT_CREDITS.
    const out = computeDebit({ steps: [step(0.00001)], totalTokens: 100 })
    expect(out.credits).toBe(MIN_DEBIT_CREDITS)
    expect(out.usedFallback).toBe(false)
  })
})

describe('formatCredits', () => {
  it('floors to one decimal', () => {
    expect(formatCredits(82.56)).toBe('82.5')
    expect(formatCredits(100)).toBe('100.0')
    expect(formatCredits(0)).toBe('0.0')
  })
})

describe('constants', () => {
  it('grants 20 credits on signup', () => {
    expect(SIGNUP_GRANT_CREDITS).toBe(20)
  })
})
