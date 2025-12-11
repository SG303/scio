import { useLocation, useNavigate, Link } from 'react-router-dom'
import { CheckCircle2, ArrowRight, Home, RotateCcw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SessionStats {
  again: number
  hard: number
  good: number
  easy: number
}

interface LocationState {
  deckId: number
  deckTitle: string
  cardsReviewed: number
  stats: SessionStats
  totalTimeMs: number
}

export default function SessionComplete() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LocationState | null

  if (!state) {
    // No session data, redirect to flashcards
    navigate('/flashcards')
    return null
  }

  const { deckId, deckTitle, cardsReviewed, stats, totalTimeMs } = state

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
          <Button asChild size="lg">
            <Link to={`/flashcards/${deckId}/study`}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Study More
            </Link>
          </Button>
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

