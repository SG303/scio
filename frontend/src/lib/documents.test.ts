import { describe, expect, it } from 'vitest'
import { chapterDraftError, groupDocuments, toChapterRanges, withEnds, type ChapterDraft } from './documents'
import type { Document } from '@/types'

const doc = (id: number, parent: number | null = null) =>
  ({ id, parent_document_id: parent }) as Document

const draft = (key: number, start: number, included = true, title = `Chapter ${key}`): ChapterDraft => ({
  key,
  title,
  start,
  included,
})

describe('groupDocuments', () => {
  it('nests chapters under their book in book order', () => {
    const groups = groupDocuments([doc(9, 1), doc(1), doc(8, 1), doc(2)])
    expect(groups.map((g) => [g.document.id, g.chapters.map((c) => c.id)])).toEqual([
      [1, [8, 9]],
      [2, []],
    ])
  })

  it('shows chapters whose book is missing as normal documents', () => {
    expect(groupDocuments([doc(5, 99)]).map((g) => g.document.id)).toEqual([5])
  })
})

describe('chapter ranges', () => {
  it('ends each chapter before the next one, the last at the end of the book', () => {
    expect(withEnds([draft(2, 40), draft(1, 10)], 100).map((d) => [d.start, d.end])).toEqual([
      [10, 39],
      [40, 100],
    ])
  })

  it('leaves out deselected chapters without extending their neighbours', () => {
    const drafts = [draft(1, 10), draft(2, 40, false), draft(3, 60)]
    expect(toChapterRanges(drafts, 80)).toEqual([
      { title: 'Chapter 1', start: 10, end: 39 },
      { title: 'Chapter 3', start: 60, end: 80 },
    ])
  })

  it('reports problems that block the split', () => {
    expect(chapterDraftError([draft(1, 5, false)], 10, 'page')).toMatch(/at least one/)
    expect(chapterDraftError([draft(1, NaN)], 10, 'page')).toMatch(/between 1 and 10/)
    expect(chapterDraftError([draft(1, 11)], 10, 'page')).toMatch(/between 1 and 10/)
    expect(chapterDraftError([draft(1, 2), draft(2, 2)], 10, 'page')).toMatch(/same page/)
    expect(chapterDraftError([draft(1, 2, true, ' ')], 10, 'page')).toMatch(/title/)
    expect(chapterDraftError([draft(1, 2), draft(2, 3, false, '')], 10, 'page')).toBeNull()
  })
})
