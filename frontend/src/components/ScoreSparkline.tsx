import { cn } from '@/lib/utils'

interface ScoreSparklineProps {
  scores: number[]
  className?: string
}

/**
 * P5.1: mini sparkline of recent test scores (0-100).
 * Renders nothing when there are fewer than two data points.
 */
export function ScoreSparkline({ scores, className }: ScoreSparklineProps) {
  if (scores.length < 2) {
    return null
  }

  const width = 80
  const height = 24
  const padding = 2

  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const range = max - min || 1

  const points = scores
    .map((score, i) => {
      const x = padding + (i / (scores.length - 1)) * (width - 2 * padding)
      const y = height - padding - ((score - min) / range) * (height - 2 * padding)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-6 w-20', className)}
      role="img"
      aria-label={`Recent scores: ${scores.join(', ')} percent`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
