import { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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

  const handleRate = (rating: 1 | 2 | 3 | 4) => {
    onRate(rating)
    // Don't reset flip state immediately - let the transition animation handle it
  }

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
  }, [isFlipped, isSubmitting])

  return (
    <div className="flex flex-col items-center w-full">
      {/* The Flipping Card */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isFlipped}
        aria-label={isFlipped ? 'Hide answer' : 'Show answer'}
        className="w-full max-w-2xl aspect-[4/3] sm:aspect-[3/2] perspective-1000 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
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
              'absolute inset-0 backface-hidden rounded-2xl',
              'bg-gradient-to-br from-slate-800 to-slate-900',
              'border border-slate-700/50 shadow-2xl shadow-black/20',
              'flex flex-col items-center justify-center p-6 sm:p-10 text-center'
            )}
          >
            <p className="text-xl sm:text-2xl font-medium text-white leading-relaxed">
              {card.front}
            </p>
            <p className="absolute bottom-6 text-sm text-slate-400">Tap or press Space to reveal answer</p>
          </div>

          {/* Back Face */}
          <div
            className={cn(
              'absolute inset-0 backface-hidden rounded-2xl rotate-y-180',
              'bg-gradient-to-br from-emerald-900/80 to-emerald-950',
              'border border-emerald-700/30 shadow-2xl shadow-black/20',
              'flex flex-col items-center justify-center p-6 sm:p-10 text-center overflow-auto'
            )}
          >
            <p className="text-lg sm:text-xl text-emerald-50 leading-relaxed whitespace-pre-wrap">
              {card.back}
            </p>
          </div>
        </div>
      </div>

      {/* Flip hint when not flipped */}
      {!isFlipped && (
        <div className="mt-6 flex items-center gap-2 text-muted-foreground animate-pulse">
          <RotateCcw className="h-4 w-4" />
          <span className="text-sm">Tap card to flip</span>
        </div>
      )}

      {/* Rating Buttons - Only show when flipped */}
      <div
        className={cn(
          'w-full max-w-lg mt-6 transition-all duration-300',
          isFlipped ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        )}
      >
        <p className="text-center text-sm text-muted-foreground mb-3">
          How well did you know this? <span className="hidden sm:inline">(press 1–4)</span>
        </p>
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          <Button
            variant="outline"
            className="flex flex-col h-auto py-3 border-red-500/30 hover:bg-red-500/10 hover:border-red-500"
            onClick={() => handleRate(1)}
            disabled={isSubmitting}
          >
            <span className="font-semibold text-red-400">Again</span>
            <span className="text-xs text-muted-foreground">{intervalHints[1]}</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col h-auto py-3 border-orange-500/30 hover:bg-orange-500/10 hover:border-orange-500"
            onClick={() => handleRate(2)}
            disabled={isSubmitting}
          >
            <span className="font-semibold text-orange-400">Hard</span>
            <span className="text-xs text-muted-foreground">{intervalHints[2]}</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col h-auto py-3 border-blue-500/30 hover:bg-blue-500/10 hover:border-blue-500"
            onClick={() => handleRate(3)}
            disabled={isSubmitting}
          >
            <span className="font-semibold text-blue-400">Good</span>
            <span className="text-xs text-muted-foreground">{intervalHints[3]}</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col h-auto py-3 border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500"
            onClick={() => handleRate(4)}
            disabled={isSubmitting}
          >
            <span className="font-semibold text-emerald-400">Easy</span>
            <span className="text-xs text-muted-foreground">{intervalHints[4]}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default FlashcardStudy

