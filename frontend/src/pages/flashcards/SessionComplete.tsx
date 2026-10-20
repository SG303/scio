import { useEffect } from 'react'
import { useLocation, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ArrowRight, Home, RotateCcw, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/QueryState'
import { EmptyState } from '@/components/EmptyState'
import { flashcardsApi, ApiError } from '@/services/api'
import { queryKeys } from '@/lib/constants'
import { cn, getScoreColor } from '@/lib/utils'
import { ratingStyles } from '@/lib/studyColors'

interface LocationState {
  deckId?: number
  deckTitle?: string
  // Full offline summary: StudySession passes these when no server session
  // exists (offline mode), so the screen renders without a backend call
  cardsReviewed?: number
  stats?: { again: number; hard: number; good: number; easy: number }
  totalTimeMs?: number
}

/**
 * P4.4: the completion screen survives a refresh — the session is loaded
 * from the backend via the `?session=<id>` search parameter. Without a
 * valid session id (offline completion) the summary comes from the
 * navigation state instead.
 */
export default function SessionComplete() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LocationState | null

  const sessionId = searchParams.get('session')
  // A missing or invalid (NaN) session param behaves like "no session":
  // the query must not fire with NaN (it would 422), and with navigation
  // state the offline summary can still be rendered
  const parsedSessionId = sessionId !== null ? parseInt(sessionId, 10) : NaN
  const sessionIdNum = Number.isFinite(parsedSessionId) ? parsedSessionId : null

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

  if (sessionIdNum === null && !state) {
    return null // redirecting to /flashcards
  }

  const waitingForDeck = deckId !== null && !state?.deckTitle && deckLoading
  // Loading only blocks when the summary must come from the backend —
  // with a state summary it renders immediately
  if ((sessionLoading && !state) || waitingForDeck) {
    return <QueryState loading />
  }

  // Error only when neither the backend data nor a state summary exists —
  // an offline completion arrives without a session id but with state
  if (sessionIdNum !== null && (sessionError || !session) && !state) {
    // A session that no longer exists is a not-found state, not a
    // connection problem
    if (sessionError instanceof ApiError && sessionError.status === 404) {
      return (
        <div className="mx-auto max-w-3xl">
          <EmptyState
            icon={SearchX}
            title="Session not found"
            description="This study session no longer exists."
            action={
              <Button variant="outline" asChild>
                <Link to="/flashcards">All Decks</Link>
              </Button>
            }
          />
        </div>
      )
    }
    return (
      <QueryState
        error={sessionError}
        onRetry={() => navigate('/flashcards')}
      />
    )
  }

  const deckTitle = state?.deckTitle ?? deck?.title ?? 'Study Session'
  const cardsReviewed = session?.cards_reviewed ?? state?.cardsReviewed ?? 0
  const stats = session
    ? {
        again: session.cards_again,
        hard: session.cards_hard,
        good: session.cards_good,
        easy: session.cards_easy,
      }
    : state?.stats ?? { again: 0, hard: 0, good: 0, easy: 0 }
  const totalTimeMs = session?.total_time_ms ?? state?.totalTimeMs ?? 0

  // Calculate time
  const totalSeconds = Math.round(totalTimeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const timeString = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  // Calculate cards per minute
  const cardsPerMinute = totalSeconds > 0 ? (cardsReviewed / (totalSeconds / 60)).toFixed(1) : '0'

  // Calculate success rate (Good + Easy / Total)
  const successRate = cardsReviewed > 0
    ? Math.round(((stats.good + stats.easy) / cardsReviewed) * 100)
    : 0

  const ratingTotal = stats.again + stats.hard + stats.good + stats.easy

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-6">
        {/* Title */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
            <CheckCircle2 className="h-5 w-5 text-success" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Session complete</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{deckTitle}</p>
        </div>

        {/* Summary: cards reviewed and rating breakdown */}
        <div className="rounded-xl border bg-card p-5 sm:p-6">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tabular-nums tracking-tight">{cardsReviewed}</span>
            <span className="text-sm text-muted-foreground">
              card{cardsReviewed !== 1 ? 's' : ''} reviewed
            </span>
          </div>

          <div
            className="mt-5 flex h-1.5 overflow-hidden rounded-full bg-secondary"
            role="img"
            aria-label={`Again ${stats.again}, Hard ${stats.hard}, Good ${stats.good}, Easy ${stats.easy}`}
          >
            {ratingTotal > 0 &&
              ratingStyles.map((style) => (
                <div
                  key={style.key}
                  className={style.fill}
                  style={{ width: `${(stats[style.key] / ratingTotal) * 100}%` }}
                />
              ))}
          </div>

          <dl className="mt-4 grid grid-cols-4 gap-2">
            {ratingStyles.map((style) => (
              <div key={style.key}>
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('h-1.5 w-1.5 rounded-full', style.fill)} aria-hidden />
                  {style.label}
                </dt>
                <dd
                  className={cn(
                    'mt-0.5 text-lg font-semibold tabular-nums',
                    stats[style.key] > 0 ? style.text : 'text-muted-foreground'
                  )}
                >
                  {stats[style.key]}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Additional Stats */}
        <dl className="grid grid-cols-3 divide-x rounded-xl border bg-card text-center">
          <div className="px-3 py-4">
            <dt className="text-xs text-muted-foreground">Time spent</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{timeString}</dd>
          </div>
          <div className="px-3 py-4">
            <dt className="text-xs text-muted-foreground">Cards/min</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{cardsPerMinute}</dd>
          </div>
          <div className="px-3 py-4">
            <dt className="text-xs text-muted-foreground">Success rate</dt>
            <dd className={cn('mt-0.5 font-semibold tabular-nums', getScoreColor(successRate))}>
              {successRate}%
            </dd>
          </div>
        </dl>

        {/* Actions */}
        <div className="flex flex-col gap-3 pt-2">
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
