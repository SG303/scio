import { useEffect } from 'react'
import { useLocation, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ArrowRight, Home, RotateCcw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/QueryState'
import { flashcardsApi } from '@/services/api'
import { queryKeys } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface LocationState {
  deckId?: number
  deckTitle?: string
}

/**
 * P4.4: the completion screen survives a refresh — the session is loaded
 * from the backend via the `?session=<id>` search parameter, with the
 * location state only as a fallback for the deck title.
 */
export default function SessionComplete() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LocationState | null

  const sessionId = searchParams.get('session')
  const sessionIdNum = sessionId ? parseInt(sessionId) : null

  const {
    data: session,
    isLoading: sessionLoading,
    error: sessionError,
  } = useQuery({
    queryKey: ['flashcard-session', sessionIdNum],
    queryFn: () => flashcardsApi.getSession(sessionIdNum!),
    enabled: sessionIdNum !== null,
    retry: false,
  })

  // Fallback deck title from the navigation state, else fetch via deck query
  const deckId = session?.deck_id ?? state?.deckId ?? null
  const {
    data: deck,
    isLoading: deckLoading,
  } = useQuery({
    queryKey: queryKeys.flashcardDeck(deckId ?? undefined),
    queryFn: () => flashcardsApi.getDeck(deckId!),
    enabled: deckId !== null && !state?.deckTitle,
    retry: false,
  })

  // No session ID and no state: nothing to show here
  useEffect(() => {
    if (sessionIdNum === null && !state) {
      navigate('/flashcards', { replace: true })
    }
  }, [sessionIdNum, state, navigate])

  if (sessionIdNum === null && state) {
    // Legacy navigation without session ID — nothing to load; go back
    return null
  }

  if (!sessionIdNum) {
    return null
  }

  const waitingForDeck = deckId !== null && !state?.deckTitle && deckLoading
  if (sessionLoading || waitingForDeck) {
    return <QueryState loading />
  }

  if (sessionError || !session) {
    return (
      <QueryState
        error={sessionError}
        onRetry={() => navigate('/flashcards')}
      />
    )
  }

  const deckTitle = state?.deckTitle ?? deck?.title ?? 'Study Session'
  const cardsReviewed = session.cards_reviewed
  const stats = {
    again: session.cards_again,
    hard: session.cards_hard,
    good: session.cards_good,
    easy: session.cards_easy,
  }

  // Calculate time
  const totalSeconds = Math.round(session.total_time_ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const timeString = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  // Calculate cards per minute
  const cardsPerMinute = totalSeconds > 0 ? (cardsReviewed / (totalSeconds / 60)).toFixed(1) : '0'

  // Calculate success rate (Good + Easy / Total)
  const successRate = cardsReviewed > 0
    ? Math.round(((stats.good + stats.easy) / cardsReviewed) * 100)
    : 0

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 text-center">
        {/* Success Icon */}
        <div className="flex justify-center">
          <div className="h-20 w-20 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          </div>
        </div>

        {/* Title */}
        <div>
          <h1 className="text-3xl font-bold mb-2">Session Complete!</h1>
          <p className="text-muted-foreground">{deckTitle}</p>
        </div>

        {/* Main Stat */}
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="pt-6">
            <div className="text-5xl font-bold text-emerald-500 mb-2">{cardsReviewed}</div>
            <div className="text-muted-foreground">cards reviewed</div>
          </CardContent>
        </Card>

        {/* Rating Breakdown */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className={cn("text-2xl font-bold", stats.again > 0 ? "text-red-400" : "text-muted-foreground")}>
              {stats.again}
            </div>
            <div className="text-xs text-muted-foreground">Again</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
            <div className={cn("text-2xl font-bold", stats.hard > 0 ? "text-orange-400" : "text-muted-foreground")}>
              {stats.hard}
            </div>
            <div className="text-xs text-muted-foreground">Hard</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className={cn("text-2xl font-bold", stats.good > 0 ? "text-blue-400" : "text-muted-foreground")}>
              {stats.good}
            </div>
            <div className="text-xs text-muted-foreground">Good</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className={cn("text-2xl font-bold", stats.easy > 0 ? "text-emerald-400" : "text-muted-foreground")}>
              {stats.easy}
            </div>
            <div className="text-xs text-muted-foreground">Easy</div>
          </div>
        </div>

        {/* Additional Stats */}
        <div className="flex justify-center gap-8 text-sm">
          <div>
            <div className="text-muted-foreground">Time spent</div>
            <div className="font-semibold">{timeString}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Cards/min</div>
            <div className="font-semibold">{cardsPerMinute}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Success rate</div>
            <div className={cn(
              "font-semibold",
              successRate >= 80 ? "text-emerald-400" :
              successRate >= 60 ? "text-blue-400" :
              successRate >= 40 ? "text-orange-400" : "text-red-400"
            )}>
              {successRate}%
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 pt-4">
          {deckId !== null && (
            <Button asChild size="lg">
              <Link to={`/flashcards/${deckId}/study`}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Study More
              </Link>
            </Button>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" asChild>
              <Link to="/flashcards">
                <ArrowRight className="h-4 w-4 mr-2" />
                All Decks
              </Link>
            </Button>
            <Button variant="outline" className="flex-1" asChild>
              <Link to="/">
                <Home className="h-4 w-4 mr-2" />
                Dashboard
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
