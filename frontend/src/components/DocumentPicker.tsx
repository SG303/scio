import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { OptionCard, DocumentOptionLabel } from '@/components/OptionCard'
import { groupDocuments } from '@/lib/documents'
import { cn } from '@/lib/utils'
import type { Document } from '@/types'

type DocumentPickerProps = {
  documents: Document[]
  selectedIds: number[]
  onToggle: (documentId: number) => void
  className?: string
}

/**
 * Multi-select of documents. Chapters split from a book are folded under
 * it, so a 40-chapter book stays one row until it is opened.
 */
export function DocumentPicker({ documents, selectedIds, onToggle, className }: DocumentPickerProps) {
  const groups = groupDocuments(documents)
  // books with a selected chapter start open, so the selection is visible
  const [openBooks, setOpenBooks] = useState<Set<number>>(
    () =>
      new Set(
        groups
          .filter((g) => g.chapters.some((c) => selectedIds.includes(c.id)))
          .map((g) => g.document.id)
      )
  )

  const toggleBook = (id: number) =>
    setOpenBooks((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className={cn('grid gap-2', className)}>
      {groups.map(({ document, chapters }) => {
        const isOpen = openBooks.has(document.id)
        const selectedChapters = chapters.filter((c) => selectedIds.includes(c.id)).length
        return (
          <div key={document.id} className="space-y-2">
            <OptionCard
              indicator="checkbox"
              selected={selectedIds.includes(document.id)}
              onClick={() => onToggle(document.id)}
            >
              <DocumentOptionLabel
                title={document.title}
                docType={chapters.length > 0 ? `${document.doc_type} · whole book` : document.doc_type}
              />
            </OptionCard>

            {chapters.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => toggleBook(document.id)}
                  aria-expanded={isOpen}
                  className="ml-3 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
                  {chapters.length} chapters
                  {selectedChapters > 0 && <span className="text-primary">({selectedChapters} selected)</span>}
                </button>
                {isOpen && (
                  <div className="ml-3 grid gap-2 border-l pl-3">
                    {chapters.map((chapter) => (
                      <OptionCard
                        key={chapter.id}
                        indicator="checkbox"
                        selected={selectedIds.includes(chapter.id)}
                        onClick={() => onToggle(chapter.id)}
                      >
                        <span className="block font-medium">{chapter.title}</span>
                        {chapter.page_start !== null && (
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            Pages {chapter.page_start}–{chapter.page_end}
                          </span>
                        )}
                      </OptionCard>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
