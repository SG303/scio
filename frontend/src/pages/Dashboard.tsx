import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText, ClipboardList, ArrowRight, Plus, Layers, Flame } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List } from '@/components/List'
import { TestRow } from '@/components/TestRow'
import { documentsApi, testsApi, flashcardsApi } from '@/services/api'
import { cn, getScoreColor } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'

export default function Dashboard() {
  const {
    data: documents = [],
    isLoading: documentsLoading,
    error: documentsError,
    refetch: refetchDocuments,
  } = useQuery({
    queryKey: queryKeys.documents,
    queryFn: documentsApi.list,
  })

  const {
    data: tests = [],
    isLoading: testsLoading,
    error: testsError,
    refetch: refetchTests,
  } = useQuery({
    queryKey: queryKeys.tests,
    queryFn: testsApi.list,
  })

  const {
    data: flashcardStats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: queryKeys.flashcardStats,
    queryFn: flashcardsApi.getGlobalStats,
  })

  // P4.2: streak, daily goal progress and what's due today
  const {
    data: streak,
    isLoading: streakLoading,
    error: streakError,
    refetch: refetchStreak,
  } = useQuery({
    queryKey: queryKeys.streak,
    queryFn: flashcardsApi.getStreak,
  })

  // P3.3: a down backend must not look like an empty account — show an
  // error with retry instead of all-zero stats
  const anyLoading = documentsLoading || testsLoading || statsLoading || streakLoading
  const anyError = documentsError || testsError || statsError || streakError
  if (anyLoading || anyError) {
    return (
      <QueryState
        loading={anyLoading}
        error={anyError}
        onRetry={() => {
          refetchDocuments()
          refetchTests()
          refetchStats()
          refetchStreak()
        }}
      />
    )
  }

  const recentTests = tests.slice(0, 5)
  const completedTests = tests.filter(t => t.status === 'completed')
  const averageScore = completedTests.length > 0
    ? Math.round(completedTests.reduce((acc, t) => acc + (t.score || 0), 0) / completedTests.length)
    : 0
  const inProgressCount = tests.filter(t => t.status === 'in_progress').length

  const kpis = [
    { label: 'Documents', value: documents.length, hint: 'Study materials' },
    { label: 'Tests taken', value: completedTests.length, hint: 'Completed' },
    {
      label: 'Average score',
      value: completedTests.length > 0 ? `${averageScore}%` : '—',
      hint: 'Across all tests',
      className: completedTests.length > 0 ? getScoreColor(averageScore) : undefined,
    },
    { label: 'In progress', value: inProgressCount, hint: 'Tests to continue' },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Dashboard"
        description="Upload study materials, generate practice tests and keep your flashcards on track."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/documents">
                <FileText className="h-4 w-4 mr-2" />
                Manage Documents
              </Link>
            </Button>
            <Button asChild>
              <Link to="/create">
                <Plus className="h-4 w-4 mr-2" />
                Create New Test
              </Link>
            </Button>
          </>
        }
      />

      {/* P4.2: streak, daily goal and due cards in one place */}
      {streak && (
        <section className="space-y-3">
          <SectionHeader
            title="Today"
            action={
              flashcardStats && flashcardStats.due_today > 0 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/flashcards">
                    Start Studying
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/flashcards">
                    <Layers className="h-4 w-4 mr-2" />
                    View Decks
                  </Link>
                </Button>
              )
            }
          />
          <div className="grid divide-y rounded-xl border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="p-5">
              <p className="text-sm text-muted-foreground">Streak</p>
              <div className="mt-1 flex items-center gap-2">
                <Flame
                  className={cn(
                    'h-5 w-5',
                    streak.current_streak > 0 ? 'text-warning' : 'text-muted-foreground'
                  )}
                />
                <span className="text-2xl font-semibold tabular-nums tracking-tight">
                  {streak.current_streak}
                </span>
                <span className="text-sm text-muted-foreground">
                  {streak.current_streak === 1 ? 'day' : 'days'}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {streak.current_streak > 0
                  ? `Longest: ${streak.longest_streak} days`
                  : 'Study today to start a new streak'}
              </p>
            </div>

            <div className="p-5">
              <p className="text-sm text-muted-foreground">Cards due</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {streak.due_today}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {flashcardStats && flashcardStats.total_cards > 0
                  ? `${flashcardStats.new_available} new · ${flashcardStats.due_reviews} review · ${flashcardStats.total_decks} decks`
                  : 'No flashcards yet'}
              </p>
            </div>

            <div className="p-5">
              <p className="text-sm text-muted-foreground">Daily goal</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {streak.reviews_today}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}/ {streak.daily_goal} cards
                </span>
              </p>
              <Progress
                value={Math.min(100, (streak.reviews_today / streak.daily_goal) * 100)}
                className="mt-3 h-1.5"
                aria-label="Daily goal progress"
              />
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeader title="Overview" />
        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card md:grid-cols-4">
          {kpis.map((kpi, i) => (
            <div
              key={kpi.label}
              className={cn(
                'p-5',
                i % 2 === 1 && 'border-l',
                i >= 2 && 'border-t md:border-t-0',
                i === 2 && 'md:border-l'
              )}
            >
              <dt className="text-sm text-muted-foreground">{kpi.label}</dt>
              <dd className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', kpi.className)}>
                {kpi.value}
              </dd>
              <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Recent tests"
          action={
            tests.length > 5 && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/tests">
                  View all
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            )
          }
        />
        {recentTests.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No tests yet"
            description="Upload some documents and create your first practice test."
            action={
              <Button asChild>
                <Link to="/create">Create Test</Link>
              </Button>
            }
          />
        ) : (
          <List>
            {recentTests.map((test) => (
              <TestRow key={test.id} test={test} />
            ))}
          </List>
        )}
      </section>
    </div>
  )
}
