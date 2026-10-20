import { describe, expect, it } from 'vitest'
import { calculateFlashcardGenerationTokens } from './utils'

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
