/** What a key press means while studying a flashcard. */
export type StudyKeyAction = { type: 'flip' } | { type: 'rate'; rating: 1 | 2 | 3 | 4 } | null

export interface StudyKeyInput {
  key: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** Tag name of the focused element the event came from, upper-case. */
  targetTag: string
  targetEditable: boolean
}

// Elements that handle Space/Enter/digits themselves — shortcuts must not hijack them
const OWN_KEY_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'])

/**
 * Map a key press to a study action. The shortcuts work wherever the focus is
 * (a new card remounts, so nothing on the card has focus), except on elements
 * that use these keys themselves.
 */
export function studyKeyAction(
  input: StudyKeyInput,
  state: { isFlipped: boolean; isSubmitting: boolean },
): StudyKeyAction {
  if (input.ctrlKey || input.metaKey || input.altKey) return null
  if (input.targetEditable || OWN_KEY_TAGS.has(input.targetTag)) return null

  if (input.key === ' ' || input.key === 'Enter') {
    // A held key must not flip back and forth
    return input.repeat ? null : { type: 'flip' }
  }
  if (input.key >= '1' && input.key <= '4' && input.key.length === 1) {
    if (!state.isFlipped || state.isSubmitting) return null
    return { type: 'rate', rating: Number(input.key) as 1 | 2 | 3 | 4 }
  }
  return null
}
