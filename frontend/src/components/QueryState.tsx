import type { ReactNode } from 'react'
import { Loader2, CloudOff, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'

type QueryStateProps = {
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  /** true → render the simple default empty state. Pages with a tailored
   * empty UI (CTA cards) keep it as children instead. */
  empty?: boolean
  emptyMessage?: string
  children?: ReactNode
}

/**
 * P3.3: shared loading/error wrapper for query-backed pages. Renders a
 * distinguishable error state with retry instead of letting a failed query
 * fall through to "not found" or an empty-list state.
 */
export function QueryState({
  loading,
  error,
  onRetry,
  empty,
  emptyMessage,
  children,
}: QueryStateProps) {
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10">
          <CloudOff className="h-5 w-5 text-destructive" />
        </div>
        <h2 className="text-base font-semibold">Could not load data</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          The server could not be reached. Make sure Scio is running, then try again.
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        )}
      </div>
    )
  }

  if (empty) {
    return <EmptyState title="Nothing here yet" description={emptyMessage} />
  }

  return <>{children ?? null}</>
}
