import { cn } from '@/lib/utils'

type StepIndicatorProps = {
  steps: string[]
  /** 1-based index of the active step. */
  current: number
  className?: string
}

/** Segmented progress for multi-step forms; labels truncate on narrow screens. */
export function StepIndicator({ steps, current, className }: StepIndicatorProps) {
  return (
    <ol className={cn('grid auto-cols-fr grid-flow-col gap-2', className)}>
      {steps.map((label, i) => {
        const step = i + 1
        const reached = step <= current
        return (
          <li key={label} className="min-w-0 space-y-2" aria-current={step === current ? 'step' : undefined}>
            <div className={cn('h-1 rounded-full transition-colors', reached ? 'bg-primary' : 'bg-border')} />
            <p
              className={cn(
                'truncate text-xs',
                step === current ? 'font-medium text-foreground' : 'text-muted-foreground'
              )}
            >
              <span className="tabular-nums">{step}.</span> {label}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
