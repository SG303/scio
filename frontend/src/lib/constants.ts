/**
 * Shared constants for the Scio application
 */

// P3.2: single source of truth for all TanStack Query cache keys.
// useQuery calls and invalidateQueries must never drift apart —
// always reference these instead of inline array literals.
type QueryId = string | number | undefined
export const queryKeys = {
  documents: ['documents'] as const,
  models: ['models'] as const,
  modelsAll: ['models', true] as const,
  subjects: ['subjects'] as const,
  subject: (id: QueryId) => ['subject', String(id ?? '')] as const,
  templates: ['templates'] as const,
  tests: ['tests'] as const,
  test: (id: QueryId) => ['test', String(id ?? '')] as const,
  flashcardDecks: ['flashcard-decks'] as const,
  flashcardDeck: (id: QueryId) => ['flashcard-deck', String(id ?? '')] as const,
  flashcardCards: (id: QueryId) => ['flashcard-cards', String(id ?? '')] as const,
  flashcardStats: ['flashcard-stats'] as const,
  streak: ['streak'] as const,
  analytics: ['analytics'] as const,
  incompleteSession: (deckId: QueryId) => ['incomplete-session', String(deckId ?? '')] as const,
  studyQueue: (deckId: QueryId, sessionId: number | null) =>
    ['study-queue', String(deckId ?? ''), sessionId] as const,
}

// Test configuration options
export const QUESTION_COUNT_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50, 60] as const
export const CHOICES_COUNT_OPTIONS = [3, 4, 5, 6] as const

// Default values for test configuration
export const DEFAULT_NUM_QUESTIONS = 10
export const DEFAULT_NUM_CHOICES = 4

// Template default question count options (subset for templates)
export const TEMPLATE_QUESTION_COUNT_OPTIONS = [5, 10, 15, 20, 25, 30] as const

