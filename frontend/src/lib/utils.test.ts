import { describe, expect, it } from 'vitest'
import { calculateFlashcardGenerationTokens, formatDate, parseApiDate } from './utils'

describe('calculateFlashcardGenerationTokens', () => {
  it('uses a single call for up to 30 cards', () => {
    expect(calculateFlashcardGenerationTokens(['a'.repeat(4000)], 30)).toEqual({
      inputTokens: 1500,
      outputTokens: 3000,
      numBatches: 1,
    })
  })

  it('batches larger requests by 25 and resends the input per batch', () => {
    expect(calculateFlashcardGenerationTokens([], 50)).toEqual({
      inputTokens: 1000,
      outputTokens: 5000,
      numBatches: 2,
    })
  })
})

describe('parseApiDate', () => {
  const utc = Date.UTC(2026, 9, 20, 20, 12, 21, 484)

  it('parses a naive API datetime as UTC', () => {
    expect(parseApiDate('2026-10-20T20:12:21.484349').getTime()).toBe(utc)
  })

  it('keeps a datetime with Z unchanged', () => {
    expect(parseApiDate('2026-10-20T20:12:21.484Z').getTime()).toBe(utc)
  })

  it('honours an explicit offset', () => {
    expect(parseApiDate('2026-10-20T20:12:21.484+00:00').getTime()).toBe(utc)
    expect(parseApiDate('2026-10-20T22:12:21.484+02:00').getTime()).toBe(utc)
    expect(parseApiDate('2026-10-20T15:12:21.484-0500').getTime()).toBe(utc)
  })

  it('leaves date-only strings to the native parser', () => {
    expect(parseApiDate('2026-10-20').getTime()).toBe(Date.UTC(2026, 9, 20))
  })

  it('copies Date inputs', () => {
    const date = new Date(utc)
    expect(parseApiDate(date).getTime()).toBe(utc)
    expect(parseApiDate(date)).not.toBe(date)
  })
})

describe('formatDate', () => {
  // Local rendering of 2026-10-20 20:12 UTC in whatever zone runs the test
  const expected = new Date(Date.UTC(2026, 9, 20, 20, 12, 21)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  it('renders a naive API datetime as the UTC instant in local time', () => {
    expect(formatDate('2026-10-20T20:12:21.484349')).toBe(expected)
  })

  it('renders a Z-suffixed datetime identically', () => {
    expect(formatDate('2026-10-20T20:12:21Z')).toBe(expected)
  })
})
