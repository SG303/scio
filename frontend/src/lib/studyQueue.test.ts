import { describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { incompleteSessionQueryOptions, queryKeys, studyQueueQueryOptions } from './constants'

describe('active study queue', () => {
  it('keeps the original card positions on focus/reconnect and reloads for a new session', async () => {
    const client = new QueryClient()
    let remaining = [1, 2, 3]
    let calls = 0
    const queryFn = async () => { calls++; return [...remaining] }
    const key = queryKeys.studyQueue('1', 1)
    const observer = new QueryObserver(client, { ...studyQueueQueryOptions, queryKey: key, queryFn })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await observer.refetch()
      remaining = [3] // Two cards have now been rated on the server.
      client.setQueryData(key, [1, 2, 3], { updatedAt: Date.now() - 600_000 })
      const query = client.getQueryCache().find({ queryKey: key })!
      query.onFocus()
      query.onOnline()
      await Promise.resolve()
      expect(calls).toBe(1)
      expect(observer.getCurrentResult().data?.[2]).toBe(3)
      const next = await client.fetchQuery({ ...studyQueueQueryOptions, queryKey: queryKeys.studyQueue('1', 2), queryFn })
      expect(next).toEqual([3])
    } finally {
      unsubscribe()
      client.clear()
    }
  })
})

describe('next visit of the study page', () => {
  // Reproduces the stale "Continue your study session?" prompt: a session
  // completed on the previous visit must not be offered (or its old card
  // list shown) again when the study page is opened shortly afterwards.
  it('asks the server again instead of reusing the previous answer or queue', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 300_000 } } })
    const visit = <T,>(options: object, queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
      new QueryObserver(client, { ...options, queryKey, queryFn })
    try {
      let incomplete = { has_incomplete_session: true, session_id: 1 }
      const sessionKey = queryKeys.incompleteSession('1')
      const firstSession = visit(incompleteSessionQueryOptions, sessionKey, async () => incomplete)
      const unsubscribe = firstSession.subscribe(() => {})
      await firstSession.refetch()
      const queueKey = queryKeys.studyQueue('1', 1)
      const firstQueue = visit(studyQueueQueryOptions, queueKey, async () => [4, 5, 6])
      const unsubscribeQueue = firstQueue.subscribe(() => {})
      await firstQueue.refetch()
      unsubscribe()
      unsubscribeQueue()
      await new Promise((resolve) => setTimeout(resolve, 0))

      incomplete = { has_incomplete_session: false, session_id: 0 }
      const secondSession = visit(incompleteSessionQueryOptions, sessionKey, async () => incomplete)
      expect(secondSession.getCurrentResult().data).toBeUndefined()
      expect(client.getQueryData(queueKey)).toBeUndefined()
    } finally {
      client.clear()
    }
  })
})
