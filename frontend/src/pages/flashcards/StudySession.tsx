import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { FlashcardStudy } from '@/components/flashcards/FlashcardStudy'
import { flashcardsApi } from '@/services/api'
import { cn } from '@/lib/utils'

export default function StudySession() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [currentIndex, setCurrentIndex] = useState(0)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [sessionStats, setSessionStats] = useState({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  })
  const [isTransitioning, setIsTransitioning] = useState(false)
  const sessionStartTime = useRef<number>(Date.now())
  const cardStartTime = useRef<number>(Date.now())

  // Fetch study queue
  const {
    data: studyQueue,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['study-queue', deckId],
    queryFn: () => flashcardsApi.getStudyQueue(parseInt(deckId!)),
    enabled: !!deckId,
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
    }) => flashcardsApi.submitReview(cardId, rating, timeTakenMs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] })
    },
  })

  // Complete session mutation
  const completeSessionMutation = useMutation({
    mutationFn: ({ sessionId, totalTimeMs }: { sessionId: number; totalTimeMs: number }) =>
      flashcardsApi.completeSession(sessionId, totalTimeMs),
  })

  // Start session on component mount
  useEffect(() => {
    if (deckId && !sessionId) {
      startSessionMutation.mutate()
    }
  }, [deckId])

  // Handle rating
  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    if (!studyQueue || currentIndex >= studyQueue.cards.length || isTransitioning) return

    const card = studyQueue.cards[currentIndex]
    const timeTakenMs = Date.now() - cardStartTime.current

    // Start transition animation
    setIsTransitioning(true)

    // Update local stats
    setSessionStats((prev) => ({
      ...prev,
      again: prev.again + (rating === 1 ? 1 : 0),
      hard: prev.hard + (rating === 2 ? 1 : 0),
      good: prev.good + (rating === 3 ? 1 : 0),
      easy: prev.easy + (rating === 4 ? 1 : 0),
    }))

    // Submit review
    await reviewMutation.mutateAsync({
      cardId: card.id,
      rating,
      timeTakenMs,
    })

    // Wait for exit animation to complete
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Move to next card or complete session
    if (currentIndex + 1 >= studyQueue.cards.length) {
      // Session complete
      const totalTimeMs = Date.now() - sessionStartTime.current

      if (sessionId) {
        await completeSessionMutation.mutateAsync({
          sessionId,
          totalTimeMs,
        })
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
      setTimeout(() => setIsTransitioning(false), 50)
    }
  }

  // Handle exit
  const handleExit = async () => {
    if (sessionId && currentIndex > 0) {
      const totalTimeMs = Date.now() - sessionStartTime.current
      await completeSessionMutation.mutateAsync({
        sessionId,
        totalTimeMs,
      })
    }
    navigate(`/flashcards/${deckId}`)
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !studyQueue) {
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

      {/* Card Area - Takes remaining space */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden">
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

