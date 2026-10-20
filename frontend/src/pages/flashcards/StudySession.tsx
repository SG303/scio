import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, CloudOff, History, Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { FlashcardStudy } from '@/components/flashcards/FlashcardStudy'
import { flashcardsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'
import { ratingStyles } from '@/lib/studyColors'
import {
  cacheStudyQueue,
  getCachedStudyQueue,
  flushOfflineReviews,
  isNetworkError,
  canStartOfflineStudy,
  queueOfflineReview,
  removeQueuedReviews,
} from '@/lib/offlineQueue'

// P2.2: a review that failed to save — offered to the user with a retry
// button for exactly this card and rating
type SaveError = {
  cardId: number
  rating: 1 | 2 | 3 | 4
}

// P2.3: human-readable interval from the review response — the real SM-2
// schedule, shown after a rating instead of made-up numbers
function formatNextReview(nextReviewAt: string | null, intervalDays: number): string {
  if (nextReviewAt) {
    const diffMs = new Date(nextReviewAt).getTime() - Date.now()
    if (Number.isFinite(diffMs)) {
      const minutes = Math.round(diffMs / 60000)
      if (minutes < 1) return 'under a minute'
      if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`
      const hours = Math.round(minutes / 60)
      if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`
    }
  }
  // Fallback: whole days from interval_days
  if (intervalDays > 0) return `${intervalDays} day${intervalDays !== 1 ? 's' : ''}`
  return 'under a minute'
}

// P5.2: single source of truth for the rating → stats-key mapping
export type SessionStats = { again: number; hard: number; good: number; easy: number }

export function ratingStatsKey(rating: 1 | 2 | 3 | 4): keyof SessionStats {
  return rating === 1 ? 'again' : rating === 2 ? 'hard' : rating === 3 ? 'good' : 'easy'
}

// P2.2 (purity): the elapsed time is measured when a rating is clicked, but
// handleRate is handed to FlashcardStudy as a prop, so the analyzer must
// assume it can run during render — where Date.now() would be impure. The
// clock read lives in this module-level helper (outside render scope); what
// is measured is unchanged: Date.now() minus the card's start time.
const nowMs = (): number => Date.now()

export default function StudySession() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [currentIndex, setCurrentIndex] = useState(0)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [pendingSessionId, setPendingSessionId] = useState<number | null>(null)
  const [showResumePrompt, setShowResumePrompt] = useState(false)
  const [cardsStudiedCount, setCardsStudiedCount] = useState(0)
  const [sessionStats, setSessionStats] = useState({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  })
  const [isTransitioning, setIsTransitioning] = useState(false)
  // P6.4: ratings are queued locally while offline
  const [isOffline, setIsOffline] = useState(false)
  const [saveError, setSaveError] = useState<SaveError | null>(null)
  const [exitFailed, setExitFailed] = useState(false)
  // P2.3: real interval of the last rated card (from ReviewResponse)
  const [nextReviewHint, setNextReviewHint] = useState<string | null>(null)
  // P2.3 (M3): started_at of a resumed session, used as the base for
  // total_time_ms instead of the page load time
  const [pendingStartedAt, setPendingStartedAt] = useState<string | null>(null)
  // P2.1/P2.2 (purity): the clocks start at 0 and are set in the mount effect
  // below — Date.now() must not run during render. Resuming overwrites
  // sessionStartTime with the session's real started_at (handleResume), a
  // fresh start keeps the mount time as the base.
  const sessionStartTime = useRef<number>(0)
  const cardStartTime = useRef<number>(0)
  // P2.2: once exit was requested, no further backend writes from this
  // component (M4) — handleRate must not fire completeSession after exit
  const exitRequestedRef = useRef(false)
  // P2.2: pending timeout must not fire after unmount
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up pending timeouts on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current)
      }
    }
  }, [])

  // P2.1/P2.2 (purity): set the study clocks after mount instead of during
  // render. User interaction (rating, resume, exit) is impossible before
  // effects run, so the measured times are unchanged.
  useEffect(() => {
    sessionStartTime.current = Date.now()
    cardStartTime.current = Date.now()
  }, [])

  // Check for incomplete session.
  // P2.1: isLoading is exposed — a new session must never start while this
  // check is still loading (that race created ghost sessions and conflicting
  // resume prompts).
  const cachedQueue = deckId ? getCachedStudyQueue(deckId) : null
  const {
    data: incompleteSession,
    isLoading: sessionChecking,
    error: incompleteSessionError,
  } = useQuery({
    queryKey: queryKeys.incompleteSession(deckId),
    queryFn: () => flashcardsApi.getIncompleteSession(parseInt(deckId!)),
    enabled: !!deckId,
  })

  // P2.1: StrictMode guards — the decision effect and the render-time state
  // adjustments below run twice in dev, and a session must only ever be
  // started (or prompted for) once per visit. decisionMade is state because
  // the offline-start and resume adjustments read it during render;
  // startAttempted stays a ref — it is only touched here in the effect.
  const [decisionMade, setDecisionMade] = useState(false)
  const startAttempted = useRef(false)

  // Start session (P2.1: declared before the decision effect that calls it —
  // P2.2 immutability). mutate is referentially stable in TanStack Query v5,
  // so the destructured function is the dependency the decision effect needs.
  const startSessionMutation = useMutation({
    mutationFn: () => flashcardsApi.startSession(parseInt(deckId!)),
    onSuccess: (session) => {
      setSessionId(session.id)
    },
  })
  const { mutate: startSession } = startSessionMutation

  // P2.1/P2.2: the offline start and the resume prompt both derive from the
  // incomplete-session check. They are adjusted during render with the
  // React-docs "adjust state when props change" pattern instead of a
  // setState-in-effect cascade. Everything below stays one-shot via the
  // decisionMade guard, exactly as in the former effect.

  // P6.4: a real network error plus a cached queue is enough to study
  // offline — no server session id in this mode, queued reviews sync when
  // connectivity returns. While the check is still loading there is no
  // error yet, so sessionChecking needs no explicit guard here.
  if (
    canStartOfflineStudy(incompleteSessionError, cachedQueue)
    && !decisionMade
    && !sessionId
    && !pendingSessionId
  ) {
    setDecisionMade(true)
    setIsOffline(true)
  }

  // P2.1: only after the check resolved — resume prompt data is applied once
  // per incompleteSession result; showResumePrompt terminates the adjustment.
  if (
    !sessionChecking
    && incompleteSession
    && incompleteSession.has_incomplete_session
    && !sessionId
    && !pendingSessionId
    && !decisionMade
    && !showResumePrompt
  ) {
    setPendingSessionId(incompleteSession.session_id || null)
    setPendingStartedAt(incompleteSession.started_at ?? null)
    setCardsStudiedCount(incompleteSession.cards_studied_count || 0)
    setShowResumePrompt(true)
  }

  // P2.1: auto-start a fresh session — only after the check resolved and
  // neither an offline start (render adjustment above) nor a resume is
  // pending. has_incomplete_session means the render adjustment above owns
  // the decision. startAttempted keeps StrictMode's double effect invocation
  // from starting two sessions.
  useEffect(() => {
    if (sessionChecking) return
    if (sessionId || pendingSessionId || decisionMade) return
    if (canStartOfflineStudy(incompleteSessionError, cachedQueue)) return
    if (!incompleteSession) return
    if (incompleteSession.has_incomplete_session) return
    if (!startAttempted.current) {
      startAttempted.current = true
      startSession()
    }
  }, [
    cachedQueue,
    decisionMade,
    incompleteSession,
    incompleteSessionError,
    pendingSessionId,
    sessionChecking,
    sessionId,
    startSession,
  ])

  // Fetch study queue
  const {
    data: studyQueue,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.studyQueue(deckId, sessionId),
    queryFn: () => flashcardsApi.getStudyQueue(parseInt(deckId!), sessionId || undefined),
    enabled: !!deckId && !!sessionId,
  })

  // P6.4: cache queue / offline fallback
  useEffect(() => {
    if (studyQueue) cacheStudyQueue(deckId!, studyQueue)
  }, [studyQueue, deckId])

  // A failed queue load with a cached copy, or a fresh offline launch with a
  // failed session check, can both use the cached queue.
  const effectiveQueue = studyQueue ?? (
    cachedQueue && (
      canStartOfflineStudy(incompleteSessionError, cachedQueue)
      || isNetworkError(error)
    )
      ? cachedQueue
      : null
  )

  // Fetch deck info for title
  const { data: deck } = useQuery({
    queryKey: queryKeys.flashcardDeck(deckId),
    queryFn: () => flashcardsApi.getDeck(parseInt(deckId!)),
    enabled: !!deckId,
  })

  // Submit review mutation
  const reviewMutation = useMutation({
    mutationFn: ({
      cardId,
      rating,
      timeTakenMs,
    }: {
      cardId: number
      rating: 1 | 2 | 3 | 4
      timeTakenMs: number
    }) => flashcardsApi.submitReview(cardId, rating, timeTakenMs, sessionId || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
    },
  })

  // Complete session mutation
  const completeSessionMutation = useMutation({
    mutationFn: ({ sessionId, totalTimeMs }: { sessionId: number; totalTimeMs: number }) =>
      flashcardsApi.completeSession(sessionId, totalTimeMs),
    onSuccess: () => {
      // P3.2: after a session ends, the deck's due counts and the global
      // stats must be fresh — the session end is the single moment where
      // these views change, so invalidate here instead of on every rating
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDeck(deckId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardStats })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
      // P4.2: the streak widget counts completed sessions
      queryClient.invalidateQueries({ queryKey: queryKeys.streak })
    },
  })

  // Handle resume
  const handleResume = () => {
    setDecisionMade(true)
    if (pendingSessionId) {
      // P2.3 (M3): base total_time_ms on the session's real start, not on
      // when this page happened to load
      if (pendingStartedAt) {
        const startedAtMs = new Date(pendingStartedAt).getTime()
        if (Number.isFinite(startedAtMs)) {
          sessionStartTime.current = startedAtMs
        }
      }
      setSessionId(pendingSessionId)
      setShowResumePrompt(false)
      setPendingSessionId(null)
      setPendingStartedAt(null)
    }
  }

  // Handle start fresh.
  // P2.1: the old session must be completed before a new one starts,
  // otherwise it lingers as an incomplete ghost session forever.
  const handleStartFresh = async () => {
    setDecisionMade(true)
    setShowResumePrompt(false)
    if (pendingSessionId) {
      try {
        await completeSessionMutation.mutateAsync({
          sessionId: pendingSessionId,
          totalTimeMs: 0,
        })
      } catch {
        // Still start fresh — completing the old session is best-effort here
        console.error('Failed to complete old session before starting fresh')
      }
    }
    setPendingSessionId(null)
    setPendingStartedAt(null)
    startSession()
  }

  // Handle rating.
  // P2.2: a failed submitReview must not freeze the session — the card
  // becomes interactive again and an inline retry banner appears instead.
  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    if (!effectiveQueue || currentIndex >= effectiveQueue.cards.length || isTransitioning) return
    if (exitRequestedRef.current) return // M4: no writes after exit

    const card = effectiveQueue.cards[currentIndex]
    const timeTakenMs = nowMs() - cardStartTime.current

    // Start transition animation
    setIsTransitioning(true)

    // Submit review
    try {
      const response = await reviewMutation.mutateAsync({
        cardId: card.id,
        rating,
        timeTakenMs,
      })
      // P2.3: show the real SM-2 interval for this card after rating
      setNextReviewHint(formatNextReview(response.next_review_at, response.interval_days))
      setIsOffline(false)
      // P6.4: this card was rated live — a stale offline queue entry for
      // it would re-apply an older rating on flush, so drop it
      removeQueuedReviews([card.id])
    } catch (err) {
      if (isNetworkError(err)) {
        // P6.4: offline — remember the rating locally and continue
        // studying; it is replayed in order once the connection returns
        queueOfflineReview({
          cardId: card.id,
          rating,
          timeTakenMs,
          sessionId: sessionId ?? null,
        })
        setIsOffline(true)
        setNextReviewHint(null)
      } else {
        // Review not saved — unfreeze the card and offer a retry for exactly
        // this card; the rating is only counted once it was actually saved
        setIsTransitioning(false)
        setSaveError({ cardId: card.id, rating })
        return
      }
    }

    setSaveError(null)
    await advanceAfterRating(rating)
  }

  // P2.2: retry the failed review — resends the same card and rating
  const handleRetrySave = () => {
    if (!saveError) return
    handleRate(saveError.rating)
  }

  // Post-rating flow: stats, animation, next card or session completion
  const advanceAfterRating = async (rating: 1 | 2 | 3 | 4) => {
    if (!effectiveQueue) return

    // Update local stats
    setSessionStats((prev) => ({
      ...prev,
      [ratingStatsKey(rating)]: prev[ratingStatsKey(rating)] + 1,
    }))

    // Wait for exit animation to complete (P2.2: tracked so it can be
    // cleaned up on unmount)
    await new Promise<void>((resolve) => {
      transitionTimeoutRef.current = setTimeout(resolve, 500)
    })

    // M4: the user exited while the animation was running — handleExit
    // already completed the session, stop here
    if (exitRequestedRef.current) return

    // Move to next card or complete session
    if (currentIndex + 1 >= effectiveQueue.cards.length) {
      // Session complete
      const totalTimeMs = Date.now() - sessionStartTime.current

      if (sessionId) {
        try {
          await completeSessionMutation.mutateAsync({
            sessionId,
            totalTimeMs,
          })
        } catch {
          // Ratings are saved per card; the session stays resumable via
          // the incomplete-session handling from P2.1 — navigate anyway
          console.error('Failed to complete session after last rating')
        }
      }

      // P4.4: navigate with the session ID so the completion screen survives
      // a refresh (it loads its data from the backend instead of state).
      // Offline there is no session id — the completion screen then renders
      // the summary from the navigation state passed below.
      navigate(
        sessionId != null
          ? `/flashcards/session-complete?session=${sessionId}`
          : '/flashcards/session-complete',
        {
          state: {
            deckId: parseInt(deckId!),
            deckTitle: deck?.title || 'Study Session',
            cardsReviewed: effectiveQueue.cards.length,
            stats: {
              ...sessionStats,
              [ratingStatsKey(rating)]: sessionStats[ratingStatsKey(rating)] + 1,
            },
            totalTimeMs,
          },
        },
      )
    } else {
      setCurrentIndex((prev) => prev + 1)
      cardStartTime.current = Date.now()
      // Reset transition state after a brief delay for enter animation
      transitionTimeoutRef.current = setTimeout(() => setIsTransitioning(false), 50)
    }
  }

  // Handle exit — P2.1: always close the session, even if no card was rated
  // (a session with 0 ratings must not survive as an incomplete ghost).
  // P2.2: a failed completeSession is surfaced instead of silently doing
  // nothing (M4).
  const handleExit = async () => {
    if (exitRequestedRef.current) return
    exitRequestedRef.current = true
    if (sessionId) {
      const totalTimeMs = Date.now() - sessionStartTime.current
      try {
        await completeSessionMutation.mutateAsync({
          sessionId,
          totalTimeMs,
        })
      } catch {
        // Ratings are already saved per card — let the user decide whether
        // to retry closing the session or leave anyway
        exitRequestedRef.current = false
        setExitFailed(true)
        return
      }
    }
    navigate(`/flashcards/${deckId}`)
  }

  // P6.4: replay offline-queued reviews when the connection is back
  useEffect(() => {
    const flush = () => void flushOfflineReviews()
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [])

  // P4.1: Esc exits the session — active only while a queue is loaded.
  // Re-subscribed each render so it always closes over the current handlers.
  useEffect(() => {
    if (!effectiveQueue || effectiveQueue.cards.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Resume prompt
  if (showResumePrompt) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center p-4 text-center">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
          <History className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Continue your study session?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You studied {cardsStudiedCount} card{cardsStudiedCount !== 1 ? 's' : ''} earlier today.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={handleStartFresh}>
            Start Fresh
          </Button>
          <Button onClick={handleResume}>
            Continue Session
          </Button>
        </div>
      </div>
    )
  }

  // P2.1: spinner while checking for an incomplete session or starting a new
  // one — previously the error screen briefly flashed during this phase.
  // A failed session start must surface as an error, not an endless spinner.
  const startFailed = startSessionMutation.isError

  if (
    sessionChecking
    || (!sessionId && !canStartOfflineStudy(incompleteSessionError, cachedQueue) && !startFailed && !incompleteSessionError)
    || isLoading
  ) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (
    (error && !effectiveQueue)
    || (incompleteSessionError && !canStartOfflineStudy(incompleteSessionError, cachedQueue))
    || startFailed
    || !effectiveQueue
  ) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center p-4 text-center">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10">
          <CloudOff className="h-5 w-5 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Failed to load study session</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Go back to the deck and try again.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => navigate(`/flashcards/${deckId}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to deck
        </Button>
      </div>
    )
  }

  if (effectiveQueue.cards.length === 0) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center p-4">
        <EmptyState
          icon={CheckCircle2}
          title="All caught up"
          description="No cards are due for review right now. Check back later."
          className="border-0"
          action={
            <Button variant="outline" onClick={() => navigate(`/flashcards/${deckId}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to deck
            </Button>
          }
        />
      </div>
    )
  }

  const card = effectiveQueue.cards[currentIndex]
  const progress = ((currentIndex + 1) / effectiveQueue.cards.length) * 100

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header - Compact */}
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-2 py-2 sm:px-4 border-b">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExit}
          className="justify-self-start text-muted-foreground hover:text-foreground"
          aria-label="Exit session"
        >
          <ArrowLeft className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Exit</span>
          <kbd className="ml-2 hidden rounded border bg-muted px-1 font-mono text-[11px] font-normal sm:inline">Esc</kbd>
        </Button>
        <h1 className="max-w-[40vw] truncate text-sm font-medium sm:max-w-xs">
          {deck?.title || 'Study Session'}
        </h1>

        <div className="justify-self-end flex items-center gap-3 pr-2 text-sm text-muted-foreground">
          {isOffline && (
            <span
              className="flex items-center gap-1.5 text-xs font-medium text-warning"
              title="Ratings are saved locally and synced once you're back online"
            >
              <CloudOff className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Offline — saved locally</span>
            </span>
          )}
          <span className="tabular-nums">
            <span className="font-medium text-foreground">{currentIndex + 1}</span>
            {' / '}
            {effectiveQueue.cards.length}
          </span>
        </div>
      </header>

      {/* Progress Bar */}
      <Progress value={progress} className="h-1 rounded-none" />

      {/* P2.2: exit could not be saved — visible error instead of a silent
          no-op; the user decides between retry and leaving anyway */}
      {exitFailed && (
        <div
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 m-4 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <span>Could not save your session. Your reviewed cards are already saved.</span>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" onClick={() => { setExitFailed(false); handleExit() }}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/flashcards/${deckId}`)}>
              Exit anyway
            </Button>
          </div>
        </div>
      )}

      {/* P2.3: real SM-2 interval of the last rated card */}
      {nextReviewHint && (
        <p className="text-center text-xs text-muted-foreground py-1.5 border-b">
          Previous card: see again in {nextReviewHint}
        </p>
      )}

      {/* Card Area - Takes remaining space */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden">
        {/* P2.2: inline retry banner for a failed review save */}
        {saveError && (
          <div
            className="mb-4 w-full max-w-2xl rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            role="alert"
          >
            <span>Save failed — your rating was not saved.</span>
            <Button size="sm" onClick={handleRetrySave} className="shrink-0">
              Try again
            </Button>
          </div>
        )}
        <div
          className={cn(
            'w-full transition-all duration-500 ease-in-out',
            isTransitioning
              ? 'opacity-0 translate-x-[-100px] scale-95'
              : 'opacity-100 translate-x-0 scale-100'
          )}
        >
          <FlashcardStudy
            key={card.id}
            card={card}
            onRate={handleRate}
            isSubmitting={reviewMutation.isPending || isTransitioning}
          />
        </div>
      </div>

      {/* Mini stats footer */}
      <div className="flex justify-center gap-5 sm:gap-6 py-3 border-t text-xs text-muted-foreground">
        {ratingStyles.map((style) => (
          <span key={style.key} className="flex items-center gap-1.5">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                sessionStats[style.key] > 0 ? style.fill : 'bg-border'
              )}
              aria-hidden
            />
            {style.label}
            <span
              className={cn(
                'tabular-nums font-medium',
                sessionStats[style.key] > 0 ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {sessionStats[style.key]}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
