import { describe, it, expect } from 'vitest'
import { newId, isUuid } from './ids'

describe('newId', () => {
  it('returns a valid uuid', () => {
    expect(isUuid(newId())).toBe(true)
  })
  it('returns a unique id each call', () => {
    expect(newId()).not.toBe(newId())
  })
})

describe('isUuid', () => {
  it('accepts a canonical uuid', () => {
    expect(isUuid('3549497d-eda3-4e66-8461-7ef45416d8e0')).toBe(true)
  })
  it('rejects the ai-sdk default nanoid format', () => {
    // @ai-sdk/provider-utils createIdGenerator default: 7-char alphanumeric.
    // chat_messages.id is a Postgres uuid column, so these must be rejected.
    expect(isUuid('aB3xZ9q')).toBe(false)
  })
  it('rejects empty string and undefined', () => {
    expect(isUuid('')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})
