import { describe, expect, it } from 'vitest'
import { studyKeyAction, type StudyKeyInput } from './studyKeys'

const press = (key: string, extra: Partial<StudyKeyInput> = {}): StudyKeyInput => ({
  key,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  targetTag: 'BODY',
  targetEditable: false,
  ...extra,
})
const state = { isFlipped: true, isSubmitting: false }

describe('studyKeyAction', () => {
  it('flips with Space and Enter even when nothing has focus', () => {
    expect(studyKeyAction(press(' '), { ...state, isFlipped: false })).toEqual({ type: 'flip' })
    expect(studyKeyAction(press('Enter'), { ...state, isFlipped: false })).toEqual({ type: 'flip' })
  })

  it('rates with 1-4 only after the flip and while no save is running', () => {
    expect(studyKeyAction(press('3'), state)).toEqual({ type: 'rate', rating: 3 })
    expect(studyKeyAction(press('3'), { ...state, isFlipped: false })).toBeNull()
    expect(studyKeyAction(press('3'), { ...state, isSubmitting: true })).toBeNull()
    expect(studyKeyAction(press('5'), state)).toBeNull()
  })

  it('ignores held keys, modifiers, and elements that use the keys themselves', () => {
    expect(studyKeyAction(press(' ', { repeat: true }), state)).toBeNull()
    expect(studyKeyAction(press(' ', { ctrlKey: true }), state)).toBeNull()
    expect(studyKeyAction(press('Enter', { targetTag: 'BUTTON' }), state)).toBeNull()
    expect(studyKeyAction(press(' ', { targetTag: 'DIV', targetEditable: true }), state)).toBeNull()
  })
})
