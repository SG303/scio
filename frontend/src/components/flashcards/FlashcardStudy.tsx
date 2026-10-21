import { useState, useEffect, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ratingStyles } from '@/lib/studyColors'
import type { FlashcardStudy as FlashcardStudyType } from '@/types'

interface FlashcardStudyProps {
  card: FlashcardStudyType
  onRate: (rating: 1 | 2 | 3 | 4) => void
  isSubmitting?: boolean
}

export function FlashcardStudy({ card, onRate, isSubmitting }: FlashcardStudyProps) {
  const [isFlipped, setIsFlipped] = useState(false)

  // P2.3: honest interval hints. The previous hardcoded numbers
  // (<10m/1d/3d/7d) contradicted the actual SM-2 scheduling — the real
  // interval depends on the card's history and is shown after the rating
  // (next_review_at), so these labels stay qualitative on purpose. Only
  // "Again" is deterministic: it always resets to the 1-minute step.
  const intervalHints: Record<1 | 2 | 3 | 4, string> = {
    1: '1m',
    2: 'shorter',
    3: 'normal',
    4: 'longer',
  }

  // Stable per onRate identity so the keyboard effect below can list it as
  // a dependency: the 1–4 shortcut must always call the current onRate
  const handleRate = useCallback(
    (rating: 1 | 2 | 3 | 4) => {
      onRate(rating)
      // Don't reset flip state immediately - let the transition animation handle it
    },
    [onRate],
  )

  // Reset flip state when card changes
  const handleFlip = () => {
    setIsFlipped(!isFlipped)
  }

  // P4.1: the flip surface is a real button — keyboard operable (Space/Enter
  // via the native button semantics) and announced by screen readers
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      handleFlip()
    }
  }

  // Until the flip, the answer and the rating buttons are only visually
  // hidden — inert keeps them out of the tab order and the accessibility
  // tree. React 18 has no typed inert prop, so the attribute is spread in
  // as an empty string (present = inert).
  const hiddenUntilFlipped = isFlipped ? {} : { inert: '', 'aria-hidden': true }

  // P4.1: rate with keys 1–4 — only after the answer was revealed and
  // while no save is in flight
  useEffect(() => {
    if (!isFlipped || isSubmitting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '4') {
        e.preventDefault()
        handleRate(Number(e.key) as 1 | 2 | 3 | 4)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFlipped, isSubmitting, handleRate])

  return (
    <div className="flex flex-col items-center w-full">
      {/* The Flipping Card */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isFlipped}
        aria-label={isFlipped ? 'Hide answer' : 'Show answer'}
        className="w-full max-w-2xl aspect-[4/3] sm:aspect-[3/2] max-h-[calc(100dvh-12rem)] perspective-1000 cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={handleFlip}
        onKeyDown={handleKeyDown}
      >
        <div
          className={cn(
            'relative w-full h-full transition-transform duration-500 transform-style-3d',
            isFlipped && 'rotate-y-180'
          )}
        >
          {/* Front Face */}
          <div
            className={cn(
              'absolute inset-0 backface-hidden rounded-xl',
              'bg-card border shadow-md',
              'flex flex-col p-5 sm:p-8'
            )}
          >
            <p className="text-xs font-medium text-muted-foreground">Question</p>
            <div className="flex flex-1 items-center justify-center overflow-auto py-4 text-center">
              <p className="text-xl sm:text-2xl font-medium tracking-tight text-card-foreground leading-relaxed">
                {card.front}
              </p>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="sm:hidden">Tap to reveal the answer</span>
              <span className="hidden sm:inline">
                Click or press <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">Space</kbd> to reveal the answer
              </span>
            </p>
          </div>

          {/* Back Face */}
          <div
            className={cn(
              'absolute inset-0 backface-hidden rounded-xl rotate-y-180',
              'bg-card border shadow-md',
              'flex flex-col p-5 sm:p-8'
            )}
            {...hiddenUntilFlipped}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              Answer
            </p>
            <div className="flex flex-1 items-center justify-center overflow-auto py-4 text-center">
              <p className="text-lg sm:text-xl text-card-foreground leading-relaxed whitespace-pre-wrap">
                {card.back}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Rating Buttons - Only show when flipped */}
      <div
        className={cn(
          'w-full max-w-lg mt-6 transition-all duration-300',
          isFlipped ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        )}
        {...hiddenUntilFlipped}
      >
        <p className="text-center text-sm text-muted-foreground mb-3">
          How well did you know this? <span className="hidden sm:inline">(press 1–4)</span>
        </p>
        {/* P6.4: two columns on phones — larger touch targets; 4 across from sm up */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {ratingStyles.map((style) => (
            <Button
              key={style.rating}
              variant="outline"
              className={cn('flex flex-col gap-0.5 h-auto py-3', style.button)}
              onClick={() => handleRate(style.rating)}
              disabled={isSubmitting}
            >
              <span className={cn('font-semibold', style.text)}>{style.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{intervalHints[style.rating]}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default FlashcardStudy

