import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn, formatContextLength, formatPricePerMillion } from '@/lib/utils'
import type { AIModel } from '@/types'

type OptionCardProps = {
  selected: boolean
  onClick: () => void
  /** checkbox for multi-select (documents), radio for single choice (model) */
  indicator: 'checkbox' | 'radio'
  children: ReactNode
}

/** Selectable row used by the document and model pickers. */
export function OptionCard({ selected, onClick, indicator, children }: OptionCardProps) {
  return (
    <button
      type="button"
      role={indicator}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent/60'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors',
          indicator === 'radio' ? 'rounded-full' : 'rounded-[4px]',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'
        )}
      >
        {selected &&
          (indicator === 'radio' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
          ) : (
            <Check className="h-3 w-3" strokeWidth={3} />
          ))}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </button>
  )
}

/** Name, context window, description and pricing of a model option. */
export function ModelOptionLabel({ model }: { model: AIModel }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{model.name}</span>
        {model.context_length && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {formatContextLength(model.context_length)} ctx
          </span>
        )}
      </div>
      {model.description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{model.description}</p>
      )}
      {model.pricing && (
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          {formatPricePerMillion(model.pricing.prompt)} / {formatPricePerMillion(model.pricing.completion)} per 1M tokens
        </p>
      )}
    </>
  )
}

/** Title and type of a document option. */
export function DocumentOptionLabel({ title, docType }: { title: string; docType: string }) {
  return (
    <>
      <span className="block font-medium">{title}</span>
      <span className="block text-xs capitalize text-muted-foreground">
        {docType.replace('_', ' ')}
      </span>
    </>
  )
}
