import { useEffect, useRef, useState } from 'react'
import { generationApi, type GenerationProgress } from '@/services/api'

const POLL_INTERVAL_MS = 1500

/**
 * P6.2: polls a generation's progress while a generate request is running.
 *
 * Pass the same token to the generate API call. The hook starts polling on
 * `start()` and stops automatically when the generation finishes, fails or
 * is cancelled. Returns the latest progress and helpers for the UI.
 */
export function useGenerationProgress() {
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const timerRef = useRef<number | null>(null)
  const activeTokenRef = useRef<string | null>(null)

  const stopPolling = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const start = (token: string) => {
    stopPolling()
    activeTokenRef.current = token
    setProgress({ status: 'running' })

    const poll = async () => {
      const token = activeTokenRef.current
      if (!token) return
      try {
        const p = await generationApi.getProgress(token)
        setProgress(p)
        if (p.status !== 'running') stopPolling()
      } catch {
        // token expired or generation not registered yet — keep waiting;
        // the main request's own error handling covers real failures
      }
    }

    timerRef.current = window.setInterval(poll, POLL_INTERVAL_MS)
    void poll()
  }

  const cancel = async () => {
    const token = activeTokenRef.current
    if (!token) return
    try {
      await generationApi.cancel(token)
    } catch {
      // already finished — nothing to cancel
    }
  }

  const reset = () => {
    stopPolling()
    activeTokenRef.current = null
    setProgress(null)
  }

  useEffect(() => stopPolling, [])

  return { progress, start, cancel, reset }
}

/**
 * Human-readable progress line for the waiting UI.
 */
export function describeProgress(p: GenerationProgress | null): string | null {
  if (!p) return null
  if (p.status !== 'running') return null
  if (p.batch !== undefined && p.batches_total) {
    return `Batch ${p.batch} of ${p.batches_total} — ${p.done ?? 0} questions done`
  }
  if (p.done !== undefined && p.total) {
    return `${p.done} of ${p.total} questions done`
  }
  return p.message ?? 'Generating…'
}
