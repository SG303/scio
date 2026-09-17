import type { FlashcardDeckInSubject, FlashcardDeckWithStats } from '@/types'

/**
 * P4.3: shared study-button logic for decks.
 *
 * `due_reviews` + `new_available` describe exactly what a fresh study queue
 * would deliver right now (the backend subtracts today's already-introduced
 * new cards from the daily quota). Basing the disabled state and the count
 * on these numbers removes the "All caught up" surprise when the daily
 * limit is exhausted but due_cards/new_cards are non-zero.
 */
export type StudiableDeck = Pick<
  FlashcardDeckWithStats & FlashcardDeckInSubject,
  'due_reviews' | 'new_available'
>

export function deckIsStudiable(deck: StudiableDeck): boolean {
  return deck.due_reviews > 0 || deck.new_available > 0
}

export function deckStudyCount(deck: StudiableDeck): number {
  return deck.due_reviews + deck.new_available
}
