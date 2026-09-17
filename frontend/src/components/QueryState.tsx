import type { ReactNode } from 'react'
import { Loader2, CloudOff, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="rounded-full bg-red-500/10 p-4">
          <CloudOff className="h-8 w-8 text-red-500" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-xl font-semibold">Could not load data</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            The server could not be reached. Make sure Scio is running, then try again.
          </p>
        </div>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        )}
      </div>
    )
  }

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-2 text-center">
        <h2 className="text-xl font-semibold">Nothing here yet</h2>
        {emptyMessage && (
          <p className="text-sm text-muted-foreground max-w-md">{emptyMessage}</p>
        )}
      </div>
    )
  }

  return <>{children ?? null}</>
}
