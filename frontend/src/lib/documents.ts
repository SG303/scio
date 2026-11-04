import type { ChapterRange, Document } from '@/types'

export type DocumentGroup = {
  document: Document
  /** Chapters split from this document, in book order. */
  chapters: Document[]
}

/** Books with their chapters nested below them; list order of books is kept. */
export function groupDocuments(documents: Document[]): DocumentGroup[] {
  const ids = new Set(documents.map((doc) => doc.id))
  const chaptersByBook = new Map<number, Document[]>()
  for (const doc of documents) {
    if (doc.parent_document_id !== null && ids.has(doc.parent_document_id)) {
      const chapters = chaptersByBook.get(doc.parent_document_id) ?? []
      chapters.push(doc)
      chaptersByBook.set(doc.parent_document_id, chapters)
    }
  }
  return documents
    .filter((doc) => doc.parent_document_id === null || !ids.has(doc.parent_document_id))
    .map((document) => ({
      document,
      chapters: (chaptersByBook.get(document.id) ?? []).sort((a, b) => a.id - b.id),
    }))
}

/** A proposed chapter while the owner reviews the split. */
export type ChapterDraft = {
  key: number
  title: string
  /** 1-based start unit (PDF page or section); NaN while the field is empty. */
  start: number
  included: boolean
}

export type ChapterDraftWithEnd = ChapterDraft & { end: number }

/**
 * Every chapter runs up to the next chapter's start, whether that one is
 * included or not; the last runs to the end. Returned in book order.
 */
export function withEnds(drafts: ChapterDraft[], unitCount: number): ChapterDraftWithEnd[] {
  const sorted = [...drafts].sort((a, b) => a.start - b.start)
  return sorted.map((draft, i) => ({
    ...draft,
    end: i + 1 < sorted.length ? sorted[i + 1].start - 1 : unitCount,
  }))
}

/** First problem that blocks the split, or null. */
export function chapterDraftError(drafts: ChapterDraft[], unitCount: number, unitLabel: string): string | null {
  if (!drafts.some((d) => d.included)) return 'Select at least one chapter.'
  for (const draft of drafts) {
    if (!Number.isInteger(draft.start) || draft.start < 1 || draft.start > unitCount) {
      return `Every chapter needs a start ${unitLabel} between 1 and ${unitCount}.`
    }
    if (draft.included && !draft.title.trim()) return 'Every selected chapter needs a title.'
  }
  if (new Set(drafts.map((d) => d.start)).size !== drafts.length) {
    return `Two chapters start on the same ${unitLabel}.`
  }
  return null
}

export function toChapterRanges(drafts: ChapterDraft[], unitCount: number): ChapterRange[] {
  return withEnds(drafts, unitCount)
    .filter((d) => d.included)
    .map(({ title, start, end }) => ({ title: title.trim(), start, end }))
}
