import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * Shared list pattern for tests, templates, documents and models: one
 * bordered surface, divided rows, a leading icon tile, metadata right
 * aligned and secondary actions collected in a trailing menu.
 */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('divide-y overflow-hidden rounded-xl border bg-card', className)}>
      {children}
    </div>
  )
}

type ListRowProps = {
  children: ReactNode
  /** Row contains a stretched link (see `rowLinkClass`) and gets a hover state. */
  interactive?: boolean
  className?: string
}

export function ListRow({ children, interactive, className }: ListRowProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-16 items-center gap-3 px-4 py-3',
        interactive && 'transition-colors hover:bg-accent/60',
        className
      )}
    >
      {children}
    </div>
  )
}

/** Makes a row's title link cover the whole row; actions stay clickable above it. */
export const rowLinkClass =
  'after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring'

export function ListIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground [&_svg]:h-4 [&_svg]:w-4',
        className
      )}
    >
      {children}
    </div>
  )
}

type RowActionsProps = {
  label: string
  children: ReactNode
  disabled?: boolean
}

/** Trailing "more" menu holding a row's secondary and destructive actions. */
export function RowActions({ label, children, disabled }: RowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative z-10 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={label}
          disabled={disabled}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
