import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { describeProgress } from '@/hooks/useGenerationProgress'
import type { GenerationProgress } from '@/services/api'

type GenerationStatusProps = {
  progress: GenerationProgress | null
  onCancel?: () => void
}

/**
 * P6.2: waiting panel for a running generation. Shows the polled progress
 * line and, once the backend reports counts, a determinate bar.
 */
export function GenerationStatus({ progress, onCancel }: GenerationStatusProps) {
  const percent =
    progress?.status === 'running' && progress.total
      ? Math.min(100, ((progress.done ?? 0) / progress.total) * 100)
      : null

  return (
    <div className="rounded-lg border bg-muted/40 p-3" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        <p className="flex-1 text-sm text-muted-foreground">
          {describeProgress(progress) ?? 'This may take a minute depending on the AI model...'}
        </p>
        {onCancel && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {percent !== null && <Progress value={percent} className="mt-3 h-1" />}
    </div>
  )
}
