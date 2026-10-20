// Shared study palette on the semantic tokens, so card states and review
// ratings read the same in light and dark mode on every page.

// Card states: one series palette for the deck pages and the Stats charts.
export const cardStates = [
  { key: 'new', label: 'New', className: 'bg-primary/40' },
  { key: 'learning', label: 'Learning', className: 'bg-warning' },
  { key: 'review', label: 'Review', className: 'bg-success' },
] as const

/** Dot/fill class for a card's state; relearning counts as learning. */
export function cardStateClass(state: string): string {
  if (state === 'new') return 'bg-primary/40'
  if (state === 'learning' || state === 'relearning') return 'bg-warning'
  if (state === 'review') return 'bg-success'
  return 'bg-muted-foreground/40'
}

// Review ratings 1–4: Again / Hard / Good / Easy.
export const ratingStyles = [
  {
    rating: 1,
    key: 'again',
    label: 'Again',
    text: 'text-destructive',
    fill: 'bg-destructive',
    button: 'hover:border-destructive/50 hover:bg-destructive/5',
  },
  {
    rating: 2,
    key: 'hard',
    label: 'Hard',
    text: 'text-warning',
    fill: 'bg-warning',
    button: 'hover:border-warning/50 hover:bg-warning/5',
  },
  {
    rating: 3,
    key: 'good',
    label: 'Good',
    text: 'text-primary',
    fill: 'bg-primary',
    button: 'hover:border-primary/50 hover:bg-primary/5',
  },
  {
    rating: 4,
    key: 'easy',
    label: 'Easy',
    text: 'text-success',
    fill: 'bg-success',
    button: 'hover:border-success/50 hover:bg-success/5',
  },
] as const
