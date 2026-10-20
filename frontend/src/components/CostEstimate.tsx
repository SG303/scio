import { Coins } from 'lucide-react'
import { cn, formatContextLength } from '@/lib/utils'

export type CostEstimates = {
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  contextUsage: number
  contextLimit: number
  hasPricing: string | boolean | undefined
  numBatches: number
}

type CostEstimateProps = {
  estimates: CostEstimates
  /** Shown when the estimated context usage exceeds the model's window. */
  overLimitMessage: string
}

/** Neutral summary of the estimated cost and context usage of a generation. */
export function CostEstimate({ estimates, overLimitMessage }: CostEstimateProps) {
  const overLimit = estimates.contextUsage > 100

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        overLimit ? 'border-destructive/50 bg-destructive/5' : 'bg-muted/40'
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Coins className="h-3.5 w-3.5" />
        Estimated cost & usage
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-muted-foreground">Estimated cost</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">
            {estimates.hasPricing ? (
              `$${estimates.estimatedCost.toFixed(4)}`
            ) : (
              <span className="text-sm font-normal italic text-muted-foreground">
                Pricing unavailable
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Context usage</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">
            <span className={cn(overLimit && 'text-destructive')}>
              {estimates.contextUsage.toFixed(1)}%
            </span>
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({formatContextLength(estimates.inputTokens)} / {formatContextLength(estimates.contextLimit)})
            </span>
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs tabular-nums text-muted-foreground">
        ~{estimates.inputTokens.toLocaleString()} input + ~{estimates.outputTokens.toLocaleString()} output tokens
        {estimates.numBatches > 1 && <> ({estimates.numBatches} API calls)</>}
      </p>

      {overLimit && (
        <p className="mt-2 text-xs font-medium text-destructive">{overLimitMessage}</p>
      )}
    </div>
  )
}
