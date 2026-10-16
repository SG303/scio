import { flashcardsApi, ApiError } from '@/services/api'
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

/**
 * Remove exactly one queued entry (cardId + queuedAt identifies it uniquely).
 * Works on the current localStorage state, so entries queued while a flush
 * is running are never touched.
 */
function removeQueuedReview(cardId: number, queuedAt: number): void {
  setReviews(
    getReviews().filter((r) => !(r.cardId === cardId && r.queuedAt === queuedAt))
  )
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
 * replay stops at the first network failure and keeps the remaining entries
 * queued for the next attempt. Cards that no longer exist (404) are dropped
 * instead of blocking the queue forever. A 400 for a completed session is
 * retried once without the session id — those ratings are legitimate and
 * must not be lost. Every successful submit removes exactly its own entry,
 * so entries queued while the flush runs survive it.
 */
async function runFlush(): Promise<number> {
  const reviews = getReviews()
  if (reviews.length === 0) return 0

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
      removeQueuedReview(review.cardId, review.queuedAt)
    } catch (err) {
      if (isNetworkError(err)) {
        // network unreachable again — stop; this and all later entries
        // stay queued untouched for the next attempt
        return synced
      }
      if (err instanceof ApiError && err.status === 400 && review.sessionId != null) {
        // the session was completed in the meantime — retry once without
        // the session id so the rating is not dropped
        try {
          await flashcardsApi.submitReview(
            review.cardId,
            review.rating,
            review.timeTakenMs,
          )
          synced += 1
          removeQueuedReview(review.cardId, review.queuedAt)
        } catch (retryErr) {
          if (isNetworkError(retryErr)) {
            // keep the entry queued and stop — it will be retried later
            return synced
          }
          // a permanent HTTP error even without the session: drop it
          removeQueuedReview(review.cardId, review.queuedAt)
        }
        continue
      }
      // other HTTP errors (e.g. 404 for a deleted card) are permanent:
      // drop the entry and continue with the next one
      removeQueuedReview(review.cardId, review.queuedAt)
    }
  }

  return synced
}

// Only one flush may run at a time: overlapping flushes (session mount +
// 'online' event during connection flapping) sent the same reviews twice,
// and a full-list rewrite dropped entries queued mid-flush. While a flush
// is running, further calls receive the same running promise.
let flushPromise: Promise<number> | null = null

export function flushOfflineReviews(): Promise<number> {
  if (flushPromise) return flushPromise
  flushPromise = runFlush().finally(() => {
    flushPromise = null
  })
  return flushPromise
}
