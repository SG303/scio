import { useMemo } from 'react'
import { diffWords, type Change } from 'diff'
import { RotateCcw, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

type LectureCompareProps = {
  original: string
  formatted: string
  onKeep: () => void
  onRestore: () => void
  restoring: boolean
}

const countWords = (changes: Change[]) =>
  changes.reduce((sum, c) => sum + (c.value.trim() ? c.value.trim().split(/\s+/).length : 0), 0)

/**
 * Before/after view of an AI formatting run: removed words are struck
 * through on the left, added words highlighted on the right, so the owner can
 * check that nothing was invented or lost.
 */
export function LectureCompare({ original, formatted, onKeep, onRestore, restoring }: LectureCompareProps) {
  const changes = useMemo(() => diffWords(original, formatted), [original, formatted])
  const added = countWords(changes.filter((c) => c.added))
  const removed = countWords(changes.filter((c) => c.removed))

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Review the formatting</h2>
          <p className="text-sm text-muted-foreground">
            {added === 0 && removed === 0
              ? 'No changes.'
              : `${added} ${added === 1 ? 'word' : 'words'} added, ${removed} removed. Check that no content was invented or lost.`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={onRestore} disabled={restoring}>
            <RotateCcw className="h-4 w-4 mr-2" />
            {restoring ? 'Restoring...' : 'Restore original'}
          </Button>
          <Button onClick={onKeep} disabled={restoring}>
            <Check className="h-4 w-4 mr-2" />
            Keep formatted
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DiffColumn label="Before" changes={changes} side="before" />
        <DiffColumn label="After" changes={changes} side="after" />
      </div>
    </div>
  )
}

function DiffColumn({ label, changes, side }: { label: string; changes: Change[]; side: 'before' | 'after' }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <div className="whitespace-pre-wrap break-words rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed">
        {changes.map((change, i) => {
          if (side === 'before' && change.added) return null
          if (side === 'after' && change.removed) return null
          if (change.removed) {
            return (
              <del key={i} className="rounded-sm bg-destructive/15 text-destructive decoration-destructive/60">
                {change.value}
              </del>
            )
          }
          if (change.added) {
            return (
              <ins key={i} className="rounded-sm bg-success/15 no-underline">
                {change.value}
              </ins>
            )
          }
          return <span key={i}>{change.value}</span>
        })}
      </div>
    </section>
  )
}
