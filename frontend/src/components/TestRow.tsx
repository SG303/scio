import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Clock } from 'lucide-react'
import { ListIcon, ListRow, rowLinkClass } from '@/components/List'
import { ScoreSparkline } from '@/components/ScoreSparkline'
import { cn, formatDate, getScoreColor } from '@/lib/utils'
import type { Test } from '@/types'

type TestRowProps = {
  test: Test
  /** Completed scores of the same template; rendered as a sparkline from 2 points. */
  scores?: number[]
  /** Trailing actions (e.g. a RowActions menu). */
  actions?: ReactNode
  /** Shown before the metadata line, e.g. a SubjectBadge. */
  badge?: ReactNode
}

/** One test in a List: opens results when completed, the test otherwise. */
export function TestRow({ test, scores, actions, badge }: TestRowProps) {
  const title = test.config_title || `Test #${test.id}`
  const href = test.status === 'completed' ? `/results/${test.id}` : `/test/${test.id}`

  return (
    <ListRow interactive>
      <ListIcon>
        {test.status === 'completed' ? (
          <CheckCircle2 className="text-success" />
        ) : test.status === 'in_progress' ? (
          <Clock className="text-primary" />
        ) : (
          <Circle />
        )}
      </ListIcon>
      <div className="min-w-0 flex-1">
        <Link to={href} className={cn('block truncate text-sm font-medium', rowLinkClass)}>
          {title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {badge && <>{badge} </>}
          {test.total_questions} questions · {formatDate(test.created_at)}
        </p>
      </div>
      {scores && scores.length >= 2 && (
        <div className="hidden shrink-0 text-muted-foreground sm:block" title="Recent scores for this template">
          <ScoreSparkline scores={scores} />
        </div>
      )}
      <div className="w-20 shrink-0 text-right text-sm">
        {test.status === 'completed' && test.score !== null ? (
          <span className={cn('font-semibold tabular-nums', getScoreColor(test.score))}>
            {test.score}%
          </span>
        ) : test.status === 'in_progress' ? (
          <span className="font-medium text-primary">Continue</span>
        ) : (
          <span className="text-muted-foreground">Start</span>
        )}
      </div>
      {actions}
    </ListRow>
  )
}
