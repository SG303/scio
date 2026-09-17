import { flashcardsApi } from '@/services/api'
import type { StudyQueueResponse } from '@/types'

/**
 * P6.4: offline studying support (single-user, localStorage-backed).
 *
 * - The study queue of each deck is cached on load, so an offline session
 *   can still show the cards that were due.
 * - Reviews submitted while offline land in a queue and are replayed in
 *   order when the connection returns. Replaying in order means the last
 *   rating for a card wins — acceptable for a single-user app.
 *
 * Deliberately no IndexedDB or service-worker API coupling: the queue is
 * tiny (card id + rating + timing) and localStorage is sufficient.
 */

const QUEUE_PREFIX = 'scio:offline:queue:'
const REVIEWS_KEY = 'scio:offline:reviews'

export interface OfflineReview {
  cardId: number
  rating: 1 | 2 | 3 | 4
  timeTakenMs: number
  sessionId?: number | null
  queuedAt: number
}

export function isNetworkError(err: unknown): boolean {
  // fetch only rejects with TypeError for network failures — HTTP errors
  // (like a 500) are handled by fetchApi and come back as Error with detail
  return err instanceof TypeError
}

/**
 * A cached queue is sufficient to start a local-only learning session after a
 * reload. Restrict this to real network failures so a 404/permission error is
 * not masked as offline mode.
 */
export function canStartOfflineStudy(
  sessionCheckError: unknown,
  cachedQueue: StudyQueueResponse | null,
): boolean {
  return isNetworkError(sessionCheckError) && cachedQueue !== null
}

// ---------- study queue cache ----------

export function cacheStudyQueue(deckId: string | number, queue: StudyQueueResponse): void {
  try {
    localStorage.setItem(`${QUEUE_PREFIX}${deckId}`, JSON.stringify(queue))
  } catch {
    // storage full/blocked — offline studying just isn't available
  }
}

export function getCachedStudyQueue(deckId: string | number): StudyQueueResponse | null {
  try {
    const raw = localStorage.getItem(`${QUEUE_PREFIX}${deckId}`)
    return raw ? (JSON.parse(raw) as StudyQueueResponse) : null
  } catch {
    return null
  }
}

// ---------- offline review queue ----------

function getReviews(): OfflineReview[] {
  try {
    const raw = localStorage.getItem(REVIEWS_KEY)
    return raw ? (JSON.parse(raw) as OfflineReview[]) : []
  } catch {
    return []
  }
}

function setReviews(reviews: OfflineReview[]): void {
  try {
    localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews))
  } catch {
    // ignore — best effort
  }
}

export function getPendingReviewCount(): number {
  return getReviews().length
}

export function queueOfflineReview(review: Omit<OfflineReview, 'queuedAt'>): void {
  const reviews = getReviews()
  reviews.push({ ...review, queuedAt: Date.now() })
  setReviews(reviews)
}

export function removeQueuedReviews(cardIds: number[]): void {
  // after a successful live save, drop any stale offline entries for the
  // same card so the rating is not applied twice on the next flush
  const drop = new Set(cardIds)
  setReviews(getReviews().filter((r) => !drop.has(r.cardId)))
}

/**
 * Replay queued reviews in order. Returns the number of synced reviews.
 *
 * Order matters for SM-2 (each rating builds on the previous state), so
 * replay stops at the first failure and keeps the remaining entries
 * queued for the next attempt. Cards that no longer exist (404) are
 * dropped instead of blocking the queue forever.
 */
export async function flushOfflineReviews(): Promise<number> {
  const reviews = getReviews()
  if (reviews.length === 0) return 0

  const remaining: OfflineReview[] = []
  let synced = 0

  for (const review of reviews) {
    try {
      await flashcardsApi.submitReview(
        review.cardId,
        review.rating,
        review.timeTakenMs,
        review.sessionId ?? undefined,
      )
      synced += 1
    } catch (err) {
      if (err instanceof TypeError) {
        // network unreachable again — keep this and all later entries
        remaining.push(review)
      }
      // an HTTP error (e.g. 404 for a deleted card) is permanent:
      // drop the entry and continue with the next one
    }
  }

  setReviews(remaining)
  return synced
}
