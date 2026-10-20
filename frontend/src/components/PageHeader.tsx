import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  /** Page-level actions; the primary action goes last (right-most). */
  actions?: ReactNode
  className?: string
}

/** Shared page anatomy: title + one-line description, actions on the right. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  )
}

type SectionHeaderProps = {
  title: ReactNode
  /** Quiet count or note shown next to the title. */
  meta?: ReactNode
  action?: ReactNode
}

export function SectionHeader({ title, meta, action }: SectionHeaderProps) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <h2 className="text-base font-semibold tracking-tight">
        {title}
        {meta !== undefined && (
          <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{meta}</span>
        )}
      </h2>
      {action}
    </div>
  )
}
