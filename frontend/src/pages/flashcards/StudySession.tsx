import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { FlashcardStudy } from '@/components/flashcards/FlashcardStudy'
import { flashcardsApi } from '@/services/api'
import { cn } from '@/lib/utils'

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
  const [saveError, setSaveError] = useState<SaveError | null>(null)
  const [exitFailed, setExitFailed] = useState(false)
  // P2.3: real interval of the last rated card (from ReviewResponse)
  const [nextReviewHint, setNextReviewHint] = useState<string | null>(null)
  // P2.3 (M3): started_at of a resumed session, used as the base for
  // total_time_ms instead of the page load time
  const [pendingStartedAt, setPendingStartedAt] = useState<string | null>(null)
  const sessionStartTime = useRef<number>(Date.now())
  const cardStartTime = useRef<number>(Date.now())
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

  // Check for incomplete session.
  // P2.1: isLoading is exposed — a new session must never start while this
  // check is still loading (that race created ghost sessions and conflicting
  // resume prompts).
  const { data: incompleteSession, isLoading: sessionChecking } = useQuery({
    queryKey: ['incomplete-session', deckId],
    queryFn: () => flashcardsApi.getIncompleteSession(parseInt(deckId!)),
    enabled: !!deckId,
  })

  // P2.1: StrictMode guards — the effect below runs twice in dev, and a
  // session must only ever be started (or prompted for) once per visit.
  const decisionMade = useRef(false)
  const startAttempted = useRef(false)

  // Handle incomplete session detection (P2.1: only after the check resolved)
  useEffect(() => {
    if (sessionChecking || !incompleteSession) return
    if (sessionId || pendingSessionId || decisionMade.current) return

    if (incompleteSession.has_incomplete_session) {
      setPendingSessionId(incompleteSession.session_id || null)
      setPendingStartedAt(incompleteSession.started_at ?? null)
      setCardsStudiedCount(incompleteSession.cards_studied_count || 0)
      setShowResumePrompt(true)
    } else if (!startAttempted.current) {
      startAttempted.current = true
      startSessionMutation.mutate()
    }
  }, [incompleteSession, sessionChecking, sessionId, pendingSessionId])

  // Fetch study queue
  const {
    data: studyQueue,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['study-queue', deckId, sessionId],
    queryFn: () => flashcardsApi.getStudyQueue(parseInt(deckId!), sessionId || undefined),
    enabled: !!deckId && !!sessionId,
  })

  // Fetch deck info for title
  const { data: deck } = useQuery({
    queryKey: ['flashcard-deck', deckId],
    queryFn: () => flashcardsApi.getDeck(parseInt(deckId!)),
    enabled: !!deckId,
  })

  // Start session on mount
  const startSessionMutation = useMutation({
    mutationFn: () => flashcardsApi.startSession(parseInt(deckId!)),
    onSuccess: (session) => {
      setSessionId(session.id)
    },
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
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] })
    },
  })

  // Complete session mutation
  const completeSessionMutation = useMutation({
    mutationFn: ({ sessionId, totalTimeMs }: { sessionId: number; totalTimeMs: number }) =>
      flashcardsApi.completeSession(sessionId, totalTimeMs),
  })

  // Handle resume
  const handleResume = () => {
    decisionMade.current = true
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
    decisionMade.current = true
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
    startSessionMutation.mutate()
  }

  // Handle rating.
  // P2.2: a failed submitReview must not freeze the session — the card
  // becomes interactive again and an inline retry banner appears instead.
  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    if (!studyQueue || currentIndex >= studyQueue.cards.length || isTransitioning) return
    if (exitRequestedRef.current) return // M4: no writes after exit

    const card = studyQueue.cards[currentIndex]
    const timeTakenMs = Date.now() - cardStartTime.current

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
    } catch {
      // Review not saved — unfreeze the card and offer a retry for exactly
      // this card; the rating is only counted once it was actually saved
      setIsTransitioning(false)
      setSaveError({ cardId: card.id, rating })
      return
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
    if (!studyQueue) return

    // Update local stats
    setSessionStats((prev) => ({
      ...prev,
      again: prev.again + (rating === 1 ? 1 : 0),
      hard: prev.hard + (rating === 2 ? 1 : 0),
      good: prev.good + (rating === 3 ? 1 : 0),
      easy: prev.easy + (rating === 4 ? 1 : 0),
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
    if (currentIndex + 1 >= studyQueue.cards.length) {
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

      // Navigate to completion screen
      navigate(`/flashcards/session-complete`, {
        state: {
          deckId: parseInt(deckId!),
          deckTitle: deck?.title || 'Study Session',
          cardsReviewed: studyQueue.cards.length,
          stats: {
            ...sessionStats,
            [rating === 1 ? 'again' : rating === 2 ? 'hard' : rating === 3 ? 'good' : 'easy']:
              sessionStats[rating === 1 ? 'again' : rating === 2 ? 'hard' : rating === 3 ? 'good' : 'easy'] + 1,
          },
          totalTimeMs,
        },
      })
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

  // Resume prompt
  if (showResumePrompt) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center p-4">
        <h2 className="text-2xl font-semibold mb-4">Continue your study session?</h2>
        <p className="text-muted-foreground mb-6">
          You studied {cardsStudiedCount} card{cardsStudiedCount !== 1 ? 's' : ''} earlier today.
        </p>
        <div className="flex gap-4">
          <Button onClick={handleResume}>
            Continue Session
          </Button>
          <Button variant="outline" onClick={handleStartFresh}>
            Start Fresh
          </Button>
        </div>
      </div>
    )
  }

  // P2.1: spinner while checking for an incomplete session or starting a new
  // one — previously the error screen briefly flashed during this phase.
  // A failed session start must surface as an error, not an endless spinner.
  const startFailed = startSessionMutation.isError

  if (sessionChecking || (!sessionId && !startFailed) || isLoading) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || startFailed || !studyQueue) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center">
        <h2 className="text-xl font-semibold mb-2">Failed to load study session</h2>
        <button
          onClick={() => navigate(`/flashcards/${deckId}`)}
          className="text-primary hover:underline"
        >
          Go back to deck
        </button>
      </div>
    )
  }

  if (studyQueue.cards.length === 0) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center p-4">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">All caught up!</h2>
          <p className="text-muted-foreground mb-6">
            No cards are due for review right now. Check back later!
          </p>
          <button
            onClick={() => navigate(`/flashcards/${deckId}`)}
            className="text-primary hover:underline"
          >
            Go back to deck
          </button>
        </div>
      </div>
    )
  }

  const card = studyQueue.cards[currentIndex]
  const progress = ((currentIndex + 1) / studyQueue.cards.length) * 100

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header - Compact */}
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <button
          onClick={handleExit}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="hidden sm:inline">Exit</span>
        </button>

        <h1 className="font-medium text-sm truncate max-w-[200px]">
          {deck?.title || 'Study Session'}
        </h1>

        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{currentIndex + 1}</span>
          <span> / {studyQueue.cards.length}</span>
        </div>
      </header>

      {/* Progress Bar */}
      <Progress value={progress} className="h-1 rounded-none" />

      {/* P2.2: exit could not be saved — visible error instead of a silent
          no-op; the user decides between retry and leaving anyway */}
      {exitFailed && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 m-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
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
          <div className="mb-4 w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
      <div className="flex justify-center gap-6 py-3 border-t text-xs text-muted-foreground">
        <span className={cn(sessionStats.again > 0 && 'text-red-400')}>
          Again: {sessionStats.again}
        </span>
        <span className={cn(sessionStats.hard > 0 && 'text-orange-400')}>
          Hard: {sessionStats.hard}
        </span>
        <span className={cn(sessionStats.good > 0 && 'text-blue-400')}>
          Good: {sessionStats.good}
        </span>
        <span className={cn(sessionStats.easy > 0 && 'text-emerald-400')}>
          Easy: {sessionStats.easy}
        </span>
      </div>
    </div>
  )
}

