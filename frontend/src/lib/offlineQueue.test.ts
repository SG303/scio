import { describe, expect, it } from 'vitest'
import { canStartOfflineStudy } from './offlineQueue'

const cachedQueue = {
  deck_id: 42,
  total_cards: 1,
  cards: [{ id: 7, front: 'Question', back: 'Answer', state: 'new' }],
}

describe('canStartOfflineStudy', () => {
  it('allows a cached queue to start after a network failure during session lookup', () => {
    expect(canStartOfflineStudy(new TypeError('Failed to fetch'), cachedQueue)).toBe(true)
  })

  it('does not hide an API error as offline mode', () => {
    expect(canStartOfflineStudy(new Error('Deck not found'), cachedQueue)).toBe(false)
  })

  it('requires a previously cached study queue', () => {
    expect(canStartOfflineStudy(new TypeError('Failed to fetch'), null)).toBe(false)
  })
})
