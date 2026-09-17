import { useQuery } from '@tanstack/react-query'
import { BarChart3, Timer, Layers, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { QueryState } from '@/components/QueryState'
import { flashcardsApi } from '@/services/api'
import { getScoreColor } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'
import type { SubjectScoreSeries } from '@/types'

/**
 * P6.3: study statistics — reviews per day, card state distribution,
 * average answer time per deck and score trend per subject.
 * All charts are plain CSS/SVG (no chart library, keeps the bundle small).
 */
export default function Stats() {
  const {
    data: analytics,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.analytics,
    queryFn: flashcardsApi.getAnalytics,
  })

  if (isLoading) {
    return <QueryState loading />
  }

  if (error || !analytics) {
    return <QueryState error={error ?? new Error('Failed to load analytics')} onRetry={refetch} />
  }

  const maxReviews = Math.max(...analytics.reviews_per_day.map((d) => d.reviews), 1)
  const stateTotal =
    analytics.state_distribution.new +
    analytics.state_distribution.learning +
    analytics.state_distribution.review

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Statistics</h1>
        <p className="text-muted-foreground">Your study activity and progress.</p>
      </div>

      {/* Reviews per day — simple CSS bar chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Reviews per Day
          </CardTitle>
          <CardDescription>Last 14 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1.5 h-40">
            {analytics.reviews_per_day.map((day) => (
              <div
                key={day.date}
                className="flex flex-1 flex-col items-center gap-1"
                title={`${day.date}: ${day.reviews} reviews`}
              >
                <span className="text-xs text-muted-foreground">
                  {day.reviews > 0 ? day.reviews : ''}
                </span>
                <div
                  className="w-full rounded-t bg-primary/80"
                  style={{ height: `${Math.max((day.reviews / maxReviews) * 100, day.reviews > 0 ? 4 : 1)}%` }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Card state distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Card States
            </CardTitle>
            <CardDescription>Across all decks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(
              [
                ['New', analytics.state_distribution.new, 'bg-blue-500'],
                ['Learning', analytics.state_distribution.learning, 'bg-orange-500'],
                ['Review', analytics.state_distribution.review, 'bg-emerald-500'],
              ] as const
            ).map(([label, value, color]) => (
              <div key={label}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{label}</span>
                  <span className="text-muted-foreground">
                    {value} ({stateTotal > 0 ? Math.round((value / stateTotal) * 100) : 0}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${color}`}
                    style={{ width: `${stateTotal > 0 ? (value / stateTotal) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Average answer time per deck */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5" />
              Average Answer Time
            </CardTitle>
            <CardDescription>
              {analytics.avg_answer_time_ms !== null
                ? `Overall: ${(analytics.avg_answer_time_ms / 1000).toFixed(1)}s`
                : 'No timed reviews yet'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {analytics.per_deck.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews recorded yet.</p>
            ) : (
              <div className="space-y-1">
                {analytics.per_deck.map((deck) => (
                  <div key={deck.deck_id} className="flex justify-between text-sm">
                    <span className="truncate pr-4">{deck.deck_title}</span>
                    <span className="text-muted-foreground shrink-0">
                      {deck.avg_time_ms !== null
                        ? `${(deck.avg_time_ms / 1000).toFixed(1)}s · ${deck.review_count} reviews`
                        : `${deck.review_count} reviews`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Score trend per subject */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Test Scores per Subject
          </CardTitle>
          <CardDescription>Completed tests in chronological order</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.subject_scores.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No completed subject tests yet — scores appear here after you finish a test that
              belongs to a subject.
            </p>
          ) : (
            <div className="space-y-4">
              {analytics.subject_scores.map((series) => (
                <SubjectScoreRow key={series.subject_id} series={series} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SubjectScoreRow({ series }: { series: SubjectScoreSeries }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium">{series.subject_title}</span>
        <span className="text-sm">
          {series.points.length} test{series.points.length !== 1 ? 's' : ''} · last:{' '}
          <span className={`font-semibold ${getScoreColor(series.points[series.points.length - 1].score)}`}>
            {series.points[series.points.length - 1].score}%
          </span>
        </span>
      </div>
      <div className="flex gap-1 items-center">
        {series.points.map((point) => (
          <div
            key={point.test_id}
            className="flex-1 h-6 rounded flex items-center justify-center text-[10px] font-medium"
            style={{
              backgroundColor: `hsl(${Math.round(point.score * 1.2)} 70% 45%)`,
            }}
            title={`${point.date}: ${point.score}%`}
          >
            {point.score}%
          </div>
        ))}
      </div>
    </div>
  )
}
