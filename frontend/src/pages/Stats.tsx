import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { QueryState } from '@/components/QueryState'
import { PageHeader } from '@/components/PageHeader'
import { flashcardsApi } from '@/services/api'
import { cn, getScoreBgColor, getScoreColor } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'
// One series palette for every chart: the accent for activity, the
// semantic tokens for card states (shared with the deck pages).
import { cardStates } from '@/lib/studyColors'
import type { SubjectScoreSeries } from '@/types'

const formatDay = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(date + 'T00:00:00').toLocaleDateString(undefined, options)

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border bg-card p-5 sm:p-6', className)}>
      <div className="mb-5 space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

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

  const days = analytics.reviews_per_day
  const maxReviews = Math.max(...days.map((d) => d.reviews), 1)
  const totalReviews = days.reduce((sum, d) => sum + d.reviews, 0)
  const stateTotal =
    analytics.state_distribution.new +
    analytics.state_distribution.learning +
    analytics.state_distribution.review
  const maxDeckTime = Math.max(...analytics.per_deck.map((d) => d.avg_time_ms ?? 0), 1)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title="Statistics" description="Your study activity and progress." />

      {/* Reviews per day — simple CSS bar chart */}
      <ChartCard
        title="Reviews per day"
        description={
          days.length > 0 ? (
            <>
              {formatDay(days[0].date, { day: 'numeric', month: 'short' })} –{' '}
              {formatDay(days[days.length - 1].date, { day: 'numeric', month: 'short' })} ·{' '}
              <span className="tabular-nums">{totalReviews}</span> reviews
            </>
          ) : (
            'Last 14 days'
          )
        }
      >
        <div className="flex h-44 items-end gap-1 border-b sm:gap-1.5">
          {days.map((day) => (
            <div
              key={day.date}
              className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
              title={`${day.date}: ${day.reviews} reviews`}
            >
              <span className="hidden text-[11px] tabular-nums text-muted-foreground sm:block">
                {day.reviews > 0 ? day.reviews : ''}
              </span>
              <div
                className={cn(
                  'w-full rounded-t-sm transition-colors',
                  day.reviews > 0 ? 'bg-primary group-hover:bg-primary/80' : 'bg-border'
                )}
                style={{
                  height: day.reviews > 0 ? `${Math.max((day.reviews / maxReviews) * 85, 3)}%` : '2px',
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1 sm:gap-1.5">
          {days.map((day, i) => (
            <span
              key={day.date}
              className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground sm:text-[11px]"
            >
              {/* day numbers keep phones readable; month at the edges from sm up */}
              {(i === 0 || i === days.length - 1) && (
                <span className="hidden sm:inline">{formatDay(day.date, { month: 'short' })} </span>
              )}
              {formatDay(day.date, { day: 'numeric' })}
            </span>
          ))}
        </div>
      </ChartCard>

      <div className="grid gap-8 md:grid-cols-2 md:gap-6">
        {/* Card state distribution */}
        <ChartCard
          title="Card states"
          description={
            <>
              Across all decks · <span className="tabular-nums">{stateTotal}</span> cards
            </>
          }
        >
          <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
            {stateTotal > 0 &&
              cardStates.map((state) => (
                <div
                  key={state.key}
                  className={state.className}
                  style={{ width: `${(analytics.state_distribution[state.key] / stateTotal) * 100}%` }}
                />
              ))}
          </div>
          <dl className="mt-5 space-y-2.5">
            {cardStates.map((state) => {
              const value = analytics.state_distribution[state.key]
              return (
                <div key={state.key} className="flex items-center justify-between text-sm">
                  <dt className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 rounded-sm', state.className)} />
                    {state.label}
                  </dt>
                  <dd className="tabular-nums text-muted-foreground">
                    <span className="font-medium text-foreground">{value}</span>{' '}
                    ({stateTotal > 0 ? Math.round((value / stateTotal) * 100) : 0}%)
                  </dd>
                </div>
              )
            })}
          </dl>
        </ChartCard>

        {/* Average answer time per deck */}
        <ChartCard
          title="Average answer time"
          description={
            analytics.avg_answer_time_ms !== null
              ? `Overall: ${(analytics.avg_answer_time_ms / 1000).toFixed(1)}s`
              : 'No timed reviews yet'
          }
        >
          {analytics.per_deck.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {analytics.per_deck.map((deck) => (
                <li key={deck.deck_id} className="space-y-1.5">
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="truncate">{deck.deck_title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {deck.avg_time_ms !== null && (
                        <span className="font-medium text-foreground">
                          {(deck.avg_time_ms / 1000).toFixed(1)}s
                        </span>
                      )}
                      {deck.avg_time_ms !== null && ' · '}
                      {deck.review_count} reviews
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${((deck.avg_time_ms ?? 0) / maxDeckTime) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>

      {/* Score trend per subject */}
      <ChartCard title="Test scores per subject" description="Completed tests in chronological order">
        {analytics.subject_scores.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No completed subject tests yet — scores appear here after you finish a test that
            belongs to a subject.
          </p>
        ) : (
          <div className="space-y-6">
            {analytics.subject_scores.map((series) => (
              <SubjectScoreRow key={series.subject_id} series={series} />
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  )
}

function SubjectScoreRow({ series }: { series: SubjectScoreSeries }) {
  const last = series.points[series.points.length - 1].score
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span className="truncate text-sm font-medium">{series.subject_title}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {series.points.length} test{series.points.length !== 1 ? 's' : ''} · last{' '}
          <span className={cn('font-semibold', getScoreColor(last))}>{last}%</span>
        </span>
      </div>
      <div className="flex h-12 items-end gap-1 border-b">
        {series.points.map((point) => (
          <div
            key={point.test_id}
            className={cn('max-w-10 flex-1 rounded-t-sm', getScoreBgColor(point.score))}
            style={{ height: `${Math.max(point.score, 4)}%` }}
            title={`${point.date}: ${point.score}%`}
          />
        ))}
      </div>
    </div>
  )
}
