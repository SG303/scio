import { describe, expect, it } from 'vitest'
import { withSubjectDefaults } from './MaterialsStep'
import type { SubjectListItem } from '@/types'

const subject = (id: number, document_ids: number[] | null) =>
  ({ id, document_ids }) as SubjectListItem

describe('withSubjectDefaults', () => {
  it('adds the subject defaults to the current selection', () => {
    expect(withSubjectDefaults([5], null, subject(1, [1, 2]))).toEqual([5, 1, 2])
  })

  it('swaps the previous subject defaults for the new ones, keeping manual picks', () => {
    expect(withSubjectDefaults([1, 2, 5], subject(1, [1, 2]), subject(2, [3]))).toEqual([5, 3])
  })

  it('removes only the defaults when switching to no subject', () => {
    expect(withSubjectDefaults([1, 5], subject(1, [1]), null)).toEqual([5])
  })

  it('does not duplicate documents that are already selected', () => {
    expect(withSubjectDefaults([2], null, subject(1, [2, 3]))).toEqual([2, 3])
  })
})
